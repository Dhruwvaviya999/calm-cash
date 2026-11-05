import { createHash, timingSafeEqual } from 'node:crypto';

import type { RequestHandler } from 'express';

import { createPrismaDeliveryStore } from '../../automation/delivery-store';
import { createPrismaJobStore } from '../../automation/job-store';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../lib/app-error';
import { WORKER_HEARTBEAT_STALE_MS } from '../notifications';

// Operator view of the moving parts (`GET /api/v1/health/status`), for monitors and runbooks.
// It reports only operational facts — states, counts, ages, and which providers are configured —
// never user data, host names, connection strings, or credentials. It exists only when
// OPS_STATUS_TOKEN is set, and requires that token as a bearer token. Readiness (`/health/ready`)
// deliberately stays narrower: a stopped worker or disabled AI must not take the API out of service.

export interface OperationsStatusDto {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  database: { status: 'up' | 'down'; latencyMs?: number };
  worker: {
    status: 'running' | 'stale' | 'never_seen' | 'unknown';
    /** Seconds since the most recent heartbeat of any worker. */
    lastSeenSecondsAgo?: number;
  };
  jobs?: {
    pending: number;
    processing: number;
    failed: number;
    /** Seconds the oldest due, unclaimed job has been waiting (0 when none). */
    oldestDueSecondsAgo: number;
  };
  emailDeliveries?: { pending: number; retryScheduled: number; failed: number };
  receiptStorage: { provider: 'local' | 'vercel-blob' };
  email: { mode: string };
  ai: { enabled: boolean };
}

export interface OperationsStatusDependencies {
  prisma: PrismaClient;
  receiptStorageProvider: 'local' | 'vercel-blob';
  emailMode: string;
  aiEnabled: boolean;
  now?: () => Date;
}

export type OperationsStatusReader = () => Promise<OperationsStatusDto>;

export function createOperationsStatusReader({
  prisma,
  receiptStorageProvider,
  emailMode,
  aiEnabled,
  now = (): Date => new Date(),
}: OperationsStatusDependencies): OperationsStatusReader {
  const jobs = createPrismaJobStore(prisma);
  const deliveries = createPrismaDeliveryStore(prisma);
  return async () => {
    const at = now();
    const base = {
      timestamp: at.toISOString(),
      receiptStorage: { provider: receiptStorageProvider },
      email: { mode: emailMode },
      ai: { enabled: aiEnabled },
    };
    const started = performance.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return {
        ...base,
        status: 'down',
        database: { status: 'down' },
        worker: { status: 'unknown' },
      };
    }
    const latencyMs = Math.round(performance.now() - started);
    const [jobCounts, deliveryCounts, heartbeat, oldestDue] = await Promise.all([
      jobs.countByStatus(),
      deliveries.countByStatus(),
      prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' } }),
      prisma.automationJob.findFirst({
        where: { status: 'pending', runAt: { lte: at } },
        orderBy: { runAt: 'asc' },
        select: { runAt: true },
      }),
    ]);
    const ageSeconds = (date: Date): number =>
      Math.max(0, Math.floor((at.getTime() - date.getTime()) / 1000));
    const worker: OperationsStatusDto['worker'] =
      heartbeat === null
        ? { status: 'never_seen' }
        : {
            status:
              at.getTime() - heartbeat.lastSeenAt.getTime() <= WORKER_HEARTBEAT_STALE_MS
                ? 'running'
                : 'stale',
            lastSeenSecondsAgo: ageSeconds(heartbeat.lastSeenAt),
          };
    return {
      ...base,
      // A missing worker means reminders and e-mails are not going out: degraded, not down.
      status: worker.status === 'running' ? 'ok' : 'degraded',
      database: { status: 'up', latencyMs },
      worker,
      jobs: {
        pending: jobCounts.pending,
        processing: jobCounts.processing,
        failed: jobCounts.failed,
        oldestDueSecondsAgo: oldestDue === null ? 0 : ageSeconds(oldestDue.runAt),
      },
      emailDeliveries: {
        pending: deliveryCounts.pending,
        retryScheduled: deliveryCounts.retry_scheduled,
        failed: deliveryCounts.failed,
      },
    };
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Bearer-token guard compared in constant time; the same 404 as an unknown route otherwise. */
export function requireOperationsToken(token: string): RequestHandler {
  const expected = digest(token);
  return (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (supplied === '' || !timingSafeEqual(digest(supplied), expected)) {
      next(
        new AppError(
          404,
          'NOT_FOUND',
          `Route ${req.method} ${req.baseUrl}${req.path} does not exist.`,
        ),
      );
      return;
    }
    next();
  };
}
