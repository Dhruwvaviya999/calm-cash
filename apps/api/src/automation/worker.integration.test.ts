import { Writable } from 'node:stream';

import {
  API_V1_PREFIX,
  calendarDateInTimeZone,
  firstOfMonth,
  addMonthsToIsoDate,
} from '@calmcash/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import {
  createTestWorker,
  drain,
  notificationsOf,
  setPreferences,
} from '../testing/automation-helpers';
import { categoryId, createAccount, newUser, record } from '../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../testing/integration-harness';
import { createPrismaDeliveryStore } from './delivery-store';
import { LEDGER_REFUSES_WRITES } from './domain';
import { createPrismaJobStore } from './job-store';
import type { WorkerRuntime } from './worker-runtime';

// The worker's durability and failure handling against the real database: claims under
// concurrency, leases and recovery, unreadable jobs, retries, expiry, and honest e-mail outcomes.

const TIME_ZONE = 'Asia/Kolkata';
const MINUTE = 60_000;

const { prisma, createContext } = useIntegrationDatabase();

async function maintenanceJobs(count: number, prefix: string, runAt: Date): Promise<void> {
  await prisma.automationJob.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      kind: 'maintenance',
      dedupeKey: `${prefix}:${index.toString()}`,
      payload: { v: 1, date: '2026-10-31' },
      runAt,
    })),
  });
}

interface Seeded {
  context: TestContext;
  user: SignedIn;
  groceries: string;
  bank: string;
  at: string;
}

/** A user with a ₹100.00 Groceries budget that alerts at 80 %. */
async function seedBudget(): Promise<Seeded> {
  const context = createContext();
  const user = await newUser(context);
  const today = calendarDateInTimeZone(context.clock.now(), TIME_ZONE);
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '10000000',
      openingBalanceDate: addMonthsToIsoDate(today, -1),
    })
  ).account.id;
  const groceries = await categoryId(user, 'expense', 'Groceries');
  await withCsrf(user.agent.post(`${API_V1_PREFIX}/budgets`), user)
    .send({
      name: 'Groceries',
      categoryId: groceries,
      limitMinor: '10000',
      currency: 'INR',
      period: 'monthly',
      startDate: firstOfMonth(today),
    })
    .expect(201);
  return {
    context,
    user,
    groceries,
    bank,
    at: new Date(context.clock.now().getTime() - 1_000).toISOString(),
  };
}

async function overspend(seeded: Seeded): Promise<void> {
  await record(seeded.user, {
    type: 'expense',
    accountId: seeded.bank,
    amountMinor: '9000',
    occurredAt: seeded.at,
    description: 'Weekly shop at the market',
    categoryId: seeded.groceries,
  });
}

describe('job queue', () => {
  it('never lets two workers claim the same job, and survives a worker that never ran', async () => {
    const now = new Date();
    await maintenanceJobs(40, 'concurrent', now);
    const store = createPrismaJobStore(prisma);
    const claims = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c'].map((workerId) =>
        store.claim({ workerId, now, leaseMs: MINUTE, limit: 25 }),
      ),
    );
    const ids = claims.flat().map((job) => job.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    // Bounded batches: no worker took more than its limit.
    for (const batch of claims) expect(batch.length).toBeLessThanOrEqual(25);
    const rows = await prisma.automationJob.findMany({ where: { id: { in: ids } } });
    expect(rows.every((row) => row.status === 'processing' && row.attempts === 1)).toBe(true);
  });

  it('recovers a lease abandoned by a crashed worker and fences the old owner out', async () => {
    const now = new Date();
    await maintenanceJobs(1, 'lease', now);
    const store = createPrismaJobStore(prisma);
    const [job] = await store.claim({ workerId: 'crashed', now, leaseMs: MINUTE, limit: 1 });
    expect(job).toBeDefined();
    if (job === undefined) return;

    // Before the lease ends nothing changes; after it, any worker recovers the job.
    expect(await store.recoverExpiredLeases(new Date(now.getTime() + 30_000))).toBe(0);
    const later = new Date(now.getTime() + 2 * MINUTE);
    expect(await store.recoverExpiredLeases(later)).toBe(1);
    expect(await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'pending',
      lastErrorCode: 'lease_expired',
      lockedBy: null,
    });
    // The crashed worker (if it was only slow) can no longer complete the job.
    expect(await store.complete(job.id, 'crashed', later)).toBe(false);

    // A restarted worker finishes it.
    const context = createContext();
    await drain(createTestWorker(prisma, { email: context.email, now: () => later }));
    expect(await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'succeeded',
      attempts: 2,
    });
  });

  it('fails unreadable jobs alone without stopping the worker', async () => {
    const now = new Date();
    await prisma.automationJob.createMany({
      data: [
        { kind: 'budget_evaluation', payload: { v: 99 }, runAt: now, dedupeKey: 'bad-version' },
        { kind: 'send_money', payload: { v: 1 }, runAt: now, dedupeKey: 'unknown-kind' },
      ],
    });
    await maintenanceJobs(1, 'good', now);
    const context = createContext();
    const [report] = await drain(
      createTestWorker(prisma, { email: context.email, now: () => now }),
    );
    expect(report?.jobs).toMatchObject({ claimed: 4, failed: 2, succeeded: 2 }); // + scheduler's run
    const failed = await prisma.automationJob.findMany({
      where: { status: 'failed' },
      orderBy: { dedupeKey: 'asc' },
    });
    expect(failed.map((row) => [row.dedupeKey, row.lastErrorCode])).toEqual([
      ['bad-version', 'invalid_payload'],
      ['unknown-kind', 'unknown_kind'],
    ]);
  });

  it('retries a failing job with growing delays, then records the failure for diagnosis', async () => {
    const seeded = await seedBudget();
    await overspend(seeded);
    // A time zone the runtime cannot read makes the evaluation throw.
    await prisma.$executeRaw`UPDATE users SET timezone = 'Not/AZone' WHERE id = ${seeded.user.session.user.id}::uuid`;
    await prisma.automationJob.updateMany({
      where: { kind: 'budget_evaluation' },
      data: { maxAttempts: 2 },
    });
    let now = seeded.context.clock.now();
    const worker = (): ReturnType<typeof createTestWorker> =>
      createTestWorker(prisma, { email: seeded.context.email, now: () => now });

    await drain(worker());
    const first = await prisma.automationJob.findFirstOrThrow({
      where: { kind: 'budget_evaluation' },
    });
    expect(first).toMatchObject({ status: 'pending', attempts: 1, lastErrorCode: 'internal' });
    expect(first.runAt.getTime() - now.getTime()).toBe(30_000);

    now = new Date(now.getTime() + 31_000);
    await drain(worker());
    expect(await prisma.automationJob.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject(
      { status: 'failed', attempts: 2, lastErrorCode: 'internal' },
    );
    // Operators can requeue it once the cause is fixed.
    await prisma.$executeRaw`UPDATE users SET timezone = ${TIME_ZONE} WHERE id = ${seeded.user.session.user.id}::uuid`;
    expect(await createPrismaJobStore(prisma).requeueFailed(now, [first.id])).toBe(1);
    await drain(worker());
    expect(await notificationsOf(prisma, seeded.user)).toHaveLength(1);
  });

  it('never records money: the worker’s ledger refuses every write', async () => {
    await expect(
      LEDGER_REFUSES_WRITES.recordLinked(
        { userId: 'x', timeZone: TIME_ZONE, preferredCurrency: 'INR' },
        {
          type: 'expense',
          accountId: 'x',
          amountMinor: '1',
          categoryId: 'x',
          description: 'x',
          occurredAt: new Date().toISOString(),
        },
        { claim: () => Promise.resolve(undefined), commit: () => Promise.resolve() },
      ),
    ).rejects.toThrow('never records transactions');
  });
});

describe('stopping', () => {
  it('finishes the job in progress and hands back the rest of the batch at once', async () => {
    const now = new Date();
    await maintenanceJobs(5, 'stopping', now);
    const context = createContext();
    const running: { worker?: WorkerRuntime } = {};
    // SIGTERM arrives while the first job runs: the log line after it triggers `stop()`.
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        if (chunk.toString('utf8').includes('Job succeeded')) void running.worker?.stop();
        done();
      },
    });
    const worker = createTestWorker(prisma, {
      email: context.email,
      now: () => now,
      logger: pino({ level: 'info' }, sink),
    });
    running.worker = worker;

    const report = await worker.runCycle();

    // The five jobs plus the scheduler's own maintenance job were claimed; only one ran.
    expect(report.jobs).toMatchObject({ claimed: 6, succeeded: 1 });
    expect(report.released).toBe(5);
    expect(report.deliveries.claimed).toBe(0); // No new batch is claimed once stopping.
    const rows = await prisma.automationJob.findMany();
    expect(rows.filter((row) => row.status === 'succeeded')).toHaveLength(1);
    const pending = rows.filter((row) => row.status === 'pending');
    expect(pending).toHaveLength(5);
    // Not attempted, so no attempt is used up and no lease is left behind.
    expect(pending.every((row) => row.attempts === 0 && row.lockedBy === null)).toBe(true);

    // Another worker (or this one after a restart) picks them up immediately.
    const next = await drain(createTestWorker(prisma, { email: context.email, now: () => now }));
    expect(next.reduce((sum, cycle) => sum + cycle.jobs.succeeded, 0)).toBe(5);
  });

  it('only the claiming worker can release a job or a delivery', async () => {
    const now = new Date();
    await maintenanceJobs(1, 'fenced', now);
    const jobs = createPrismaJobStore(prisma);
    const [job] = await jobs.claim({ workerId: 'worker-a', now, leaseMs: MINUTE, limit: 1 });
    if (job === undefined) throw new Error('Nothing claimed.');

    expect(await jobs.release(job.id, 'worker-b', now)).toBe(false);
    expect(await jobs.release(job.id, 'worker-a', now)).toBe(true);
    expect(await jobs.release(job.id, 'worker-a', now)).toBe(false);
    expect(await prisma.automationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'pending',
      attempts: 0,
      lockedBy: null,
      lockedUntil: null,
    });
  });
});

describe('e-mail delivery', () => {
  async function queuedEmail(seeded: Seeded): Promise<string> {
    await setPreferences(seeded.user, { channels: { budget_alerts: { email: true } } });
    await overspend(seeded);
    await drain(
      createTestWorker(prisma, { email: seeded.context.email, now: seeded.context.clock.now }),
    );
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { userId: seeded.user.session.user.id },
    });
    return delivery.id;
  }

  it('retries a temporary failure, gives up after its attempts, and keeps the notification', async () => {
    const seeded = await seedBudget();
    seeded.context.email.failWith = 'retryable';
    const id = await queuedEmail(seeded);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'retry_scheduled',
      attempts: 1,
      outcomeUncertain: false,
    });
    await prisma.notificationDelivery.update({ where: { id }, data: { maxAttempts: 2 } });

    const later = new Date(seeded.context.clock.now().getTime() + 2 * MINUTE);
    await drain(createTestWorker(prisma, { email: seeded.context.email, now: () => later }));
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'failed',
      attempts: 2,
      lastErrorCode: 'simulated_retryable',
    });
    // The in-app alert is untouched, and a notice explains the e-mail problem.
    const types = (await notificationsOf(prisma, seeded.user)).map((row) => row.type).sort();
    expect(types).toEqual(['budget_approaching_limit', 'email_delivery_problem']);
    const unread = await seeded.user.agent.get(`${API_V1_PREFIX}/notifications/unread-count`);
    expect(unread.body).toEqual({ success: true, data: { unreadCount: 2 } });
  });

  it('releases a claimed delivery without spending an attempt or marking it uncertain', async () => {
    const seeded = await seedBudget();
    seeded.context.email.failWith = 'retryable';
    const id = await queuedEmail(seeded);
    const later = new Date(seeded.context.clock.now().getTime() + 2 * MINUTE);
    const deliveries = createPrismaDeliveryStore(prisma);
    const claimed = await deliveries.claim({
      workerId: 'stopping-worker',
      now: later,
      leaseMs: MINUTE,
      limit: 5,
    });
    expect(claimed.map((delivery) => delivery.id)).toEqual([id]);

    expect(await deliveries.release(id, 'stopping-worker', later)).toBe(true);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'retry_scheduled',
      attempts: 1,
      lockedBy: null,
      outcomeUncertain: false,
    });
  });

  it('stops at once on a permanent failure such as a rejected recipient', async () => {
    const seeded = await seedBudget();
    seeded.context.email.failWith = 'permanent';
    const id = await queuedEmail(seeded);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastErrorCode: 'simulated_permanent',
    });
    expect(
      seeded.context.email.attempts.filter((m) => m.template.startsWith('notification:')),
    ).toHaveLength(1);
  });

  it('records an ambiguous attempt as uncertain and retries with the same message ID', async () => {
    const seeded = await seedBudget();
    seeded.context.email.failWith = 'ambiguous';
    const id = await queuedEmail(seeded);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'retry_scheduled',
      outcomeUncertain: true,
      lastErrorCode: 'simulated_ambiguous',
    });
    seeded.context.email.failWith = undefined;
    const later = new Date(seeded.context.clock.now().getTime() + 2 * MINUTE);
    await drain(createTestWorker(prisma, { email: seeded.context.email, now: () => later }));
    // Sent — and still flagged: the first attempt may also have arrived.
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'sent',
      outcomeUncertain: true,
    });
    const attempts = seeded.context.email.attempts.filter((m) =>
      m.template.startsWith('notification:'),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.messageId).toBeDefined();
    expect(attempts[1]?.messageId).toBe(attempts[0]?.messageId);
  });

  it('suppresses queued e-mail when the preference is switched off or the address is unverified', async () => {
    const seeded = await seedBudget();
    seeded.context.email.failWith = 'retryable';
    const id = await queuedEmail(seeded);
    await setPreferences(seeded.user, { channels: { budget_alerts: { email: false } } });
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'suppressed',
      lastErrorCode: 'preference_off',
    });
    // The in-app history is kept.
    expect(await notificationsOf(prisma, seeded.user)).toHaveLength(1);

    const other = await seedBudget();
    other.context.email.failWith = 'retryable';
    const otherId = await queuedEmail(other);
    await prisma.user.update({
      where: { id: other.user.session.user.id },
      data: { emailVerifiedAt: null },
    });
    other.context.email.failWith = undefined;
    const later = new Date(other.context.clock.now().getTime() + 2 * MINUTE);
    await drain(createTestWorker(prisma, { email: other.context.email, now: () => later }));
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: otherId } }),
    ).toMatchObject({ status: 'suppressed', lastErrorCode: 'email_unverified' });
  });

  it('does not send an e-mail that expired while it waited', async () => {
    const seeded = await seedBudget();
    seeded.context.email.failWith = 'retryable';
    const id = await queuedEmail(seeded);
    const delivery = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    seeded.context.email.failWith = undefined;
    const afterExpiry = new Date((delivery.expiresAt ?? new Date()).getTime() + MINUTE);
    await drain(createTestWorker(prisma, { email: seeded.context.email, now: () => afterExpiry }));
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'failed',
      lastErrorCode: 'expired_while_retrying',
    });
    expect(
      seeded.context.email.outbox.filter((m) => m.template.startsWith('notification:')),
    ).toEqual([]);
  });

  it('keeps addresses, names, descriptions, and amounts out of the worker’s logs', async () => {
    const seeded = await seedBudget();
    await setPreferences(seeded.user, { channels: { budget_alerts: { email: true } } });
    await overspend(seeded);
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const logger = pino({ level: 'trace' }, sink);
    seeded.context.email.failWith = 'ambiguous';
    await drain(
      createTestWorker(prisma, {
        email: seeded.context.email,
        now: seeded.context.clock.now,
        logger,
      }),
    );
    const log = lines.join('');
    expect(log).toContain('Job succeeded');
    expect(log).toContain('E-mail delivery processed');
    for (const secret of [
      seeded.user.session.user.email,
      seeded.user.session.user.name,
      'Groceries',
      'Weekly shop',
      '₹',
      '9000',
    ]) {
      expect(log, secret).not.toContain(secret);
    }
  });
});
