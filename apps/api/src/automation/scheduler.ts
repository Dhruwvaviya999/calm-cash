import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  startOfDayInTimeZone,
  zonedDateTimeToInstant,
  type DailyReviewPayload,
  type MaintenancePayload,
} from '@calmcash/shared';

import type { PrismaClient } from '../generated/prisma/client';
import type { JobStore, NewJob } from './job-store';

// The scheduler turns the calendar into durable jobs. Each tick enqueues, for every verified user,
// the daily review of *their* current calendar day (due at the configured local hour, expiring at
// their local midnight), and one maintenance run per UTC day. Every job has a permanent identity
// (`dedupe_key`), so ticks from overlapping or concurrent workers, restarts, and repeated runs add
// nothing twice; the worker's own clock and time zone never matter. A day the worker missed
// entirely is not replayed: its review expired at midnight, and the next day's review catches up
// on whatever is still relevant (see reminders.ts and monthly-summary.ts).

const USERS_PER_PAGE = 500;

export function dailyReviewKey(userId: string, localDate: string): string {
  return `daily_review:${userId}:${localDate}`;
}

export function maintenanceKey(utcDate: string): string {
  return `maintenance:${utcDate}`;
}

/** The daily review job of one user for the calendar day `now` falls on in their time zone. */
export function dailyReviewJob(
  user: { id: string; timezone: string },
  now: Date,
  reviewHour: number,
): NewJob {
  const localDate = calendarDateInTimeZone(now, user.timezone);
  const payload: DailyReviewPayload = { v: 1, localDate };
  const hour = `${reviewHour.toString().padStart(2, '0')}:00`;
  return {
    kind: 'daily_review',
    userId: user.id,
    dedupeKey: dailyReviewKey(user.id, localDate),
    payload,
    runAt: zonedDateTimeToInstant(localDate, hour, user.timezone),
    expiresAt: startOfDayInTimeZone(addDaysToIsoDate(localDate, 1), user.timezone),
  };
}

export interface SchedulerReport {
  reviewsEnqueued: number;
  maintenanceEnqueued: number;
  skippedUsers: number;
}

export interface Scheduler {
  tick: (now: Date) => Promise<SchedulerReport>;
}

export function createScheduler(
  prisma: PrismaClient,
  jobs: JobStore,
  { reviewHour }: { reviewHour: number },
): Scheduler {
  return {
    tick: async (now) => {
      let reviewsEnqueued = 0;
      let skippedUsers = 0;
      let cursor: string | undefined;
      for (;;) {
        // Only verified users can sign in, so only they are reviewed.
        const users = await prisma.user.findMany({
          where: {
            emailVerifiedAt: { not: null },
            ...(cursor === undefined ? {} : { id: { gt: cursor } }),
          },
          select: { id: true, timezone: true },
          orderBy: { id: 'asc' },
          take: USERS_PER_PAGE,
        });
        if (users.length === 0) break;
        cursor = users.at(-1)?.id;
        const batch: NewJob[] = [];
        for (const user of users) {
          try {
            batch.push(dailyReviewJob(user, now, reviewHour));
          } catch {
            // A time zone this runtime cannot resolve: skip the user rather than the whole tick.
            skippedUsers += 1;
          }
        }
        reviewsEnqueued += await jobs.enqueue(batch, now);
        if (users.length < USERS_PER_PAGE) break;
      }

      const date = now.toISOString().slice(0, 10);
      const payload: MaintenancePayload = { v: 1, date };
      const maintenanceEnqueued = await jobs.enqueue(
        [
          {
            kind: 'maintenance',
            userId: null,
            dedupeKey: maintenanceKey(date),
            payload,
            runAt: now,
            expiresAt: new Date(`${addDaysToIsoDate(date, 1)}T00:00:00.000Z`),
            maxAttempts: 3,
          },
        ],
        now,
      );
      return { reviewsEnqueued, maintenanceEnqueued, skippedUsers };
    },
  };
}
