import { API_V1_PREFIX } from '@calmcash/shared';
import { pino, type Logger } from 'pino';
import { expect } from 'vitest';

import { createWorkerRuntime, type CycleReport, type WorkerRuntime } from '../automation';
import type { Notification, PrismaClient } from '../generated/prisma/client';
import type { EmailService } from '../lib/email';
import { TEST_ALLOWED_ORIGIN } from './create-test-app';
import { withCsrf, type SignedIn } from './integration-harness';

// Helpers for integration tests of the background worker. The worker runs in-process against the
// test database with an injected clock and an in-memory e-mail service — never a mail server.

export const NOTIFICATIONS = `${API_V1_PREFIX}/notifications`;

export interface TestWorkerOptions {
  email: EmailService;
  now: () => Date;
  workerId?: string;
  logger?: Logger;
  batchSize?: number;
}

/** A worker whose daily reviews are due from local midnight, so tests never wait for 08:00. */
export function createTestWorker(
  prisma: PrismaClient,
  { email, now, workerId = 'test-worker', logger, batchSize = 20 }: TestWorkerOptions,
): WorkerRuntime {
  return createWorkerRuntime({
    prisma,
    email,
    logger: logger ?? pino({ level: 'silent' }),
    webAppUrl: TEST_ALLOWED_ORIGIN,
    now,
    settings: {
      workerId,
      batchSize,
      leaseMs: 60_000,
      pollIntervalMs: 1_000,
      schedulerIntervalMs: 60_000,
      dailyReviewHour: 0,
    },
  });
}

/** Runs cycles until a cycle claims nothing (at most ten). */
export async function drain(worker: WorkerRuntime): Promise<CycleReport[]> {
  const reports: CycleReport[] = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const report = await worker.runCycle();
    reports.push(report);
    if (report.jobs.claimed === 0 && report.deliveries.claimed === 0) {
      return reports;
    }
  }
  throw new Error('The worker kept finding work after ten cycles.');
}

/** A user's notifications, oldest first (including e-mail-only ones). */
export function notificationsOf(prisma: PrismaClient, user: SignedIn): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId: user.session.user.id },
    orderBy: [{ createdAt: 'asc' }, { dedupeKey: 'asc' }],
  });
}

export async function setPreferences(user: SignedIn, body: Record<string, unknown>): Promise<void> {
  const response = await withCsrf(user.agent.patch(`${NOTIFICATIONS}/preferences`), user).send(
    body,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

/** Queues a fresh daily review for a user (a new identity, as another day's scheduler would). */
export async function queueReview(
  prisma: PrismaClient,
  user: SignedIn,
  localDate: string,
  runAt: Date,
  label: string,
): Promise<void> {
  await prisma.automationJob.create({
    data: {
      kind: 'daily_review',
      userId: user.session.user.id,
      dedupeKey: `test-review:${label}:${user.session.user.id}`,
      payload: { v: 1, localDate },
      runAt,
    },
  });
}
