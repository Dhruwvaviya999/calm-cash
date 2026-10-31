import { AUTOMATION_JOB_KINDS, automationJobPayloadSchema } from '@calmcash/shared';
import { ZodError } from 'zod';

import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { AppError } from '../lib/app-error';
import type { EmailService } from '../lib/email';
import type { Logger } from '../lib/logger';
import { evaluateBudgetAlerts } from './budget-alerts';
import { processDelivery, type DeliveryOutcome } from './delivery-processor';
import { createPrismaDeliveryStore, type DeliveryStore } from './delivery-store';
import { createAutomationDomain, loadUserContext, type AutomationDomain } from './domain';
import { createPrismaJobStore, type ClaimedJob, type JobStore } from './job-store';
import { runMaintenance } from './maintenance';
import { sendMonthlySummaries } from './monthly-summary';
import { createNotificationWriter, type NotificationWriter } from './notification-writer';
import { sendReminders } from './reminders';
import { decideRetry, JOB_RETRY_POLICY } from './retry-policy';
import { createScheduler, type Scheduler } from './scheduler';

// The background worker's engine, independent of process concerns (signals, health server, env),
// which live in apps/worker. One cycle: recover leases abandoned by crashed workers, expire work
// that is no longer useful, run the scheduler when due, then process one bounded batch of jobs and
// one of e-mail deliveries. Everything durable is in PostgreSQL; the in-process loop only decides
// when to look, so a stopped worker loses nothing and several workers can run side by side.

export interface WorkerSettings {
  workerId: string;
  batchSize: number;
  leaseMs: number;
  pollIntervalMs: number;
  schedulerIntervalMs: number;
  dailyReviewHour: number;
}

export interface WorkerRuntimeDependencies {
  prisma: PrismaClient;
  email: EmailService;
  logger: Logger;
  /** Origin of the web app, for links in e-mails. */
  webAppUrl: string;
  settings: WorkerSettings;
  now?: () => Date;
}

export interface CycleReport {
  recovered: number;
  expired: number;
  scheduled: boolean;
  jobs: { claimed: number; succeeded: number; retried: number; failed: number };
  deliveries: Record<DeliveryOutcome, number> & { claimed: number };
}

export interface WorkerStatus {
  workerId: string;
  startedAt: Date;
  running: boolean;
  cycles: number;
  lastCycleAt: Date | undefined;
  lastCycleOk: boolean | undefined;
}

export interface WorkerRuntime {
  /** One full cycle (also used by tests and the CLI). */
  runCycle: () => Promise<CycleReport>;
  /** Starts the polling loop; resolves once `stop()` was called and the current cycle ended. */
  start: () => Promise<void>;
  stop: () => Promise<void>;
  status: () => WorkerStatus;
  jobs: JobStore;
  deliveries: DeliveryStore;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_ERROR_BACKOFF_MS = 60_000;

/** A short, safe classification of an unexpected error (never its message, which may hold data). */
export function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `prisma_${error.code.toLowerCase()}`;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return 'database_unavailable';
  if (error instanceof ZodError) return 'invalid_data';
  if (error instanceof AppError) return `app_${error.code.toLowerCase()}`;
  return 'internal';
}

interface JobHandlers {
  domain: AutomationDomain;
  writer: NotificationWriter;
  jobs: JobStore;
  deliveries: DeliveryStore;
}

async function runJob(
  prisma: PrismaClient,
  handlers: JobHandlers,
  job: ClaimedJob,
  now: Date,
): Promise<Record<string, number>> {
  const parsed = automationJobPayloadSchema.parse({ kind: job.kind, payload: job.payload });
  const context = { domain: handlers.domain, writer: handlers.writer };
  if (parsed.kind === 'maintenance') {
    return { ...(await runMaintenance(prisma, handlers, now)) };
  }
  if (job.userId === null) {
    throw new AppError(400, 'BAD_REQUEST', 'This job needs a user.');
  }
  const user = await loadUserContext(prisma, job.userId);
  if (user === undefined) {
    return {}; // The account is gone; nothing to tell anyone.
  }
  switch (parsed.kind) {
    case 'budget_evaluation':
      return { budgetAlerts: await evaluateBudgetAlerts(context, user, now) };
    case 'daily_review':
      // Today is re-read in the user's current time zone; the payload's date is the identity.
      return {
        reminders: await sendReminders(context, user, now),
        summaries: await sendMonthlySummaries(context, user, now),
        budgetAlerts: await evaluateBudgetAlerts(context, user, now),
      };
  }
}

export function createWorkerRuntime({
  prisma,
  email,
  logger,
  webAppUrl,
  settings,
  now = (): Date => new Date(),
}: WorkerRuntimeDependencies): WorkerRuntime {
  const jobs = createPrismaJobStore(prisma);
  const deliveries = createPrismaDeliveryStore(prisma);
  const writer = createNotificationWriter(prisma);
  const domain = createAutomationDomain(prisma, now);
  const scheduler: Scheduler = createScheduler(prisma, jobs, {
    reviewHour: settings.dailyReviewHour,
  });
  const handlers: JobHandlers = { domain, writer, jobs, deliveries };
  const log = logger.child({ workerId: settings.workerId });

  const state: WorkerStatus = {
    workerId: settings.workerId,
    startedAt: now(),
    running: false,
    cycles: 0,
    lastCycleAt: undefined,
    lastCycleOk: undefined,
  };
  let nextSchedulerRun = 0;
  let lastHeartbeat = 0;
  // Mutated from `stop()` while the loop awaits, so kept in an object the loop re-reads.
  const control: { stopping: boolean; wake: (() => void) | undefined } = {
    stopping: false,
    wake: undefined,
  };
  let loop: Promise<void> | undefined;
  const isStopping = (): boolean => control.stopping;

  const heartbeat = async (at: Date): Promise<void> => {
    if (at.getTime() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    await prisma.workerHeartbeat.upsert({
      where: { id: settings.workerId },
      create: { id: settings.workerId, startedAt: state.startedAt, lastSeenAt: at },
      update: { lastSeenAt: at },
    });
    lastHeartbeat = at.getTime();
  };

  const handleJob = async (
    job: ClaimedJob,
    at: Date,
  ): Promise<'succeeded' | 'retried' | 'failed'> => {
    const fields = { jobId: job.id, kind: job.kind, attempt: job.attempts };
    const parsed = automationJobPayloadSchema.safeParse({ kind: job.kind, payload: job.payload });
    if (!parsed.success) {
      // A job this deployment cannot read (another version, or corrupted) fails alone.
      const known = AUTOMATION_JOB_KINDS.some((kind) => kind === job.kind);
      const code = known ? 'invalid_payload' : 'unknown_kind';
      await jobs.fail(job.id, settings.workerId, code, at);
      log.warn({ ...fields, code }, 'Job skipped: payload not readable');
      return 'failed';
    }
    try {
      const counts = await runJob(prisma, handlers, job, at);
      if (!(await jobs.complete(job.id, settings.workerId, now()))) {
        log.warn(fields, 'Job finished after its lease was recovered by another worker');
      }
      log.info({ ...fields, ...counts }, 'Job succeeded');
      return 'succeeded';
    } catch (error: unknown) {
      const code = errorCode(error);
      const decision = decideRetry(JOB_RETRY_POLICY, job, now());
      if (decision.action === 'retry') {
        await jobs.retry(job.id, settings.workerId, { at: decision.at, errorCode: code }, now());
        log.warn({ ...fields, code, retryAt: decision.at.toISOString() }, 'Job failed; retrying');
        return 'retried';
      }
      await jobs.fail(job.id, settings.workerId, code, now());
      log.error({ ...fields, code, reason: decision.reason }, 'Job failed permanently');
      return 'failed';
    }
  };

  const runCycle = async (): Promise<CycleReport> => {
    const at = now();
    const report: CycleReport = {
      recovered: 0,
      expired: 0,
      scheduled: false,
      jobs: { claimed: 0, succeeded: 0, retried: 0, failed: 0 },
      deliveries: {
        claimed: 0,
        sent: 0,
        retry_scheduled: 0,
        failed: 0,
        suppressed: 0,
        lease_lost: 0,
      },
    };
    try {
      await heartbeat(at);
      report.recovered =
        (await jobs.recoverExpiredLeases(at)) + (await deliveries.recoverExpiredLeases(at));
      report.expired = (await jobs.expireOverdue(at)) + (await deliveries.expireOverdue(at));
      if (at.getTime() >= nextSchedulerRun) {
        const scheduled = await scheduler.tick(at);
        nextSchedulerRun = at.getTime() + settings.schedulerIntervalMs;
        report.scheduled = true;
        if (scheduled.reviewsEnqueued + scheduled.maintenanceEnqueued > 0) {
          log.info({ ...scheduled }, 'Scheduled work enqueued');
        }
      }

      const claimed = await jobs.claim({
        workerId: settings.workerId,
        now: at,
        leaseMs: settings.leaseMs,
        limit: settings.batchSize,
      });
      report.jobs.claimed = claimed.length;
      for (const job of claimed) {
        report.jobs[await handleJob(job, now())] += 1;
      }

      const batch = await deliveries.claim({
        workerId: settings.workerId,
        now: now(),
        leaseMs: settings.leaseMs,
        limit: settings.batchSize,
      });
      report.deliveries.claimed = batch.length;
      for (const delivery of batch) {
        let outcome: DeliveryOutcome;
        try {
          outcome = await processDelivery(
            {
              prisma,
              domain,
              deliveries,
              writer,
              email,
              logger: log,
              webAppUrl,
              workerId: settings.workerId,
            },
            delivery,
            now(),
          );
        } catch (error: unknown) {
          // Re-checking failed (e.g. the database blipped): try again later, nothing was sent.
          const code = errorCode(error);
          const decision = decideRetry(
            { baseDelayMs: 60_000, maxDelayMs: 3_600_000 },
            delivery,
            now(),
          );
          outcome =
            decision.action === 'retry' &&
            (await deliveries.scheduleRetry(
              delivery.id,
              settings.workerId,
              { at: decision.at, errorCode: code, uncertain: false },
              now(),
            ))
              ? 'retry_scheduled'
              : (await deliveries.markFailed(
                    delivery.id,
                    settings.workerId,
                    { errorCode: code, uncertain: false },
                    now(),
                  ))
                ? 'failed'
                : 'lease_lost';
        }
        report.deliveries[outcome] += 1;
        log.info(
          { deliveryId: delivery.id, attempt: delivery.attempts, outcome },
          'E-mail delivery processed',
        );
      }
      state.lastCycleOk = true;
      return report;
    } catch (error: unknown) {
      state.lastCycleOk = false;
      throw error;
    } finally {
      state.cycles += 1;
      state.lastCycleAt = now();
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        control.wake = undefined;
        resolve();
      }
      control.wake = done;
    });

  const start = (): Promise<void> => {
    if (loop !== undefined) return loop;
    control.stopping = false;
    state.running = true;
    loop = (async () => {
      let failures = 0;
      while (!control.stopping) {
        let busy = false;
        try {
          const report = await runCycle();
          failures = 0;
          busy =
            report.jobs.claimed >= settings.batchSize ||
            report.deliveries.claimed >= settings.batchSize;
        } catch (error: unknown) {
          failures += 1;
          log.error({ code: errorCode(error), failures }, 'Worker cycle failed');
        }
        // `stop()` may have been called while the cycle ran.
        if (isStopping()) break;
        // A full batch means more is waiting: continue at once. Failures back off.
        const pause =
          failures > 0
            ? Math.min(MAX_ERROR_BACKOFF_MS, settings.pollIntervalMs * 2 ** failures)
            : busy
              ? 0
              : settings.pollIntervalMs;
        if (pause > 0) await sleep(pause);
      }
      state.running = false;
    })();
    return loop;
  };

  return {
    runCycle,
    start,
    stop: async () => {
      control.stopping = true;
      control.wake?.();
      await loop;
      loop = undefined;
    },
    status: () => ({ ...state }),
    jobs,
    deliveries,
  };
}
