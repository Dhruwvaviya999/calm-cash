import type { PrismaClient } from '../generated/prisma/client';
import type { DeliveryStore } from './delivery-store';
import type { JobStore } from './job-store';

// Retention. Notifications are kept for 400 days — longer than any period an alert or reminder
// can still be evaluated for (a yearly budget's period), so a deleted notification's identity can
// never be re-created while it is still relevant. (A custom budget whose single period is longer
// than that could alert once more for a level notified over 400 days ago; that is the documented
// limit.) Finished deliveries are kept 90 days and finished jobs 30 days for diagnosis, and
// heartbeats of workers gone for a week are removed.

const DAY_MS = 24 * 60 * 60 * 1000;

export const NOTIFICATION_RETENTION_DAYS = 400;
export const DELIVERY_RETENTION_DAYS = 90;
export const JOB_RETENTION_DAYS = 30;
export const HEARTBEAT_RETENTION_DAYS = 7;

export interface MaintenanceReport {
  notifications: number;
  deliveries: number;
  jobs: number;
  heartbeats: number;
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
  return {
    notifications: notifications.count,
    deliveries,
    jobs,
    heartbeats: heartbeats.count,
  };
}
