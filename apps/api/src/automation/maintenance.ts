import type { PrismaClient } from '../generated/prisma/client';
import { createPrismaAuthRepository } from '../modules/auth/auth.repository';
import { CLEANUP_RETENTION_MS } from '../modules/auth/session-cleanup';
import type { DeliveryStore } from './delivery-store';
import type { JobStore } from './job-store';

// Retention. Notifications are kept for 400 days — longer than any period an alert or reminder
// can still be evaluated for (a yearly budget's period), so a deleted notification's identity can
// never be re-created while it is still relevant. (A custom budget whose single period is longer
// than that could alert once more for a level notified over 400 days ago; that is the documented
// limit.) Finished deliveries are kept 90 days and finished jobs 30 days for diagnosis, and
// heartbeats of workers gone for a week are removed. Rate-limit counters are removed a day after
// their window ended (an expired counter already counts as zero). Unusable sessions and used
// e-mail tokens are deleted here too (the API's own hourly timer does not run reliably on
// serverless hosts); the worker does not know the API's idle timeout, so it assumes the longest
// allowed one and can never end a session that is still usable.

const DAY_MS = 24 * 60 * 60 * 1000;

export const NOTIFICATION_RETENTION_DAYS = 400;
export const DELIVERY_RETENTION_DAYS = 90;
export const JOB_RETENTION_DAYS = 30;
export const HEARTBEAT_RETENTION_DAYS = 7;
export const RATE_LIMIT_RETENTION_DAYS = 1;
/** SESSION_IDLE_TIMEOUT_HOURS may be at most 90 days (env validation). */
const LONGEST_SESSION_IDLE_MS = 90 * DAY_MS;

export interface MaintenanceReport {
  notifications: number;
  deliveries: number;
  jobs: number;
  heartbeats: number;
  rateLimitCounters: number;
  sessions: number;
  authTokens: number;
}

export async function runMaintenance(
  prisma: PrismaClient,
  stores: { jobs: JobStore; deliveries: DeliveryStore },
  now: Date,
): Promise<MaintenanceReport> {
  const before = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
  const deliveries = await stores.deliveries.deleteFinished(before(DELIVERY_RETENTION_DAYS));
  const notifications = await prisma.notification.deleteMany({
    where: { createdAt: { lt: before(NOTIFICATION_RETENTION_DAYS) } },
  });
  const jobs = await stores.jobs.deleteFinished(before(JOB_RETENTION_DAYS));
  const heartbeats = await prisma.workerHeartbeat.deleteMany({
    where: { lastSeenAt: { lt: before(HEARTBEAT_RETENTION_DAYS) } },
  });
  // Counted in the API (lib/rate-limit.ts); deleted here so serverless API instances need no timer.
  const rateLimitCounters = await prisma.rateLimitCounter.deleteMany({
    where: { resetAt: { lt: before(RATE_LIMIT_RETENTION_DAYS) } },
  });
  const auth = await createPrismaAuthRepository(prisma).deleteStaleRecords({
    endedBefore: new Date(now.getTime() - CLEANUP_RETENTION_MS),
    idleBefore: new Date(now.getTime() - LONGEST_SESSION_IDLE_MS - CLEANUP_RETENTION_MS),
    tokensEndedBefore: new Date(now.getTime() - CLEANUP_RETENTION_MS),
  });
  return {
    notifications: notifications.count,
    deliveries,
    jobs,
    heartbeats: heartbeats.count,
    rateLimitCounters: rateLimitCounters.count,
    sessions: auth.sessions,
    authTokens: auth.tokens,
  };
}
