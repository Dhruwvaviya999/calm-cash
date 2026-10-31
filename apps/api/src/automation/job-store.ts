import type { AutomationJobStatus } from '@calmcash/shared';
import { z } from 'zod';

import type { Prisma, PrismaClient } from '../generated/prisma/client';

// PostgreSQL-backed job queue. Jobs are claimed in bounded batches with `FOR UPDATE SKIP LOCKED`,
// so concurrent workers never claim the same job, and each claim carries a lease (`locked_by`,
// `locked_until`). Completion is fenced by the lease: a worker whose lease was recovered by
// another can no longer change the job. No database transaction stays open while a job runs.

export interface NewJob {
  kind: string;
  userId: string | null;
  /** Permanent identity: a second job with the same key is never created. */
  dedupeKey?: string;
  payload: Prisma.InputJsonValue;
  runAt: Date;
  expiresAt?: Date;
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  userId: string | null;
  /** Raw stored payload; validated by the worker before use. */
  payload: unknown;
  /** Including the current one. */
  attempts: number;
  maxAttempts: number;
  expiresAt: Date | null;
}

export interface ClaimOptions {
  workerId: string;
  now: Date;
  leaseMs: number;
  limit: number;
}

export interface JobStore {
  /** Inserts jobs, skipping any whose unique key already exists; returns how many were added. */
  enqueue: (jobs: readonly NewJob[], now: Date) => Promise<number>;
  claim: (options: ClaimOptions) => Promise<ClaimedJob[]>;
  /** Each of these returns false when the lease was lost (nothing is changed then). */
  complete: (jobId: string, workerId: string, now: Date) => Promise<boolean>;
  retry: (
    jobId: string,
    workerId: string,
    retry: { at: Date; errorCode: string },
    now: Date,
  ) => Promise<boolean>;
  fail: (jobId: string, workerId: string, errorCode: string, now: Date) => Promise<boolean>;
  /** Jobs whose worker vanished: back to pending, or failed once their attempts are used up. */
  recoverExpiredLeases: (now: Date) => Promise<number>;
  /** Waiting jobs past their expiry stop being eligible (never replayed blindly). */
  expireOverdue: (now: Date) => Promise<number>;
  countByStatus: () => Promise<Record<AutomationJobStatus, number>>;
  /** Operator recovery: failed jobs back to pending with fresh attempts (optionally only some). */
  requeueFailed: (now: Date, jobIds?: readonly string[]) => Promise<number>;
  /** Retention: removes finished jobs completed before `before`. */
  deleteFinished: (before: Date) => Promise<number>;
}

const claimedRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  userId: z.string().nullable(),
  payload: z.unknown(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  expiresAt: z.date().nullable(),
});

const countRowSchema = z.object({ status: z.string(), count: z.number().int() });

const STATUSES: readonly AutomationJobStatus[] = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
];

function isStatus(value: string): value is AutomationJobStatus {
  return STATUSES.some((status) => status === value);
}

export function createPrismaJobStore(prisma: PrismaClient): JobStore {
  return {
    enqueue: async (jobs, now) => {
      if (jobs.length === 0) return 0;
      const { count } = await prisma.automationJob.createMany({
        data: jobs.map((job) => ({
          kind: job.kind,
          userId: job.userId,
          dedupeKey: job.dedupeKey ?? null,
          payload: job.payload,
          runAt: job.runAt,
          expiresAt: job.expiresAt ?? null,
          maxAttempts: job.maxAttempts ?? 5,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
      return count;
    },

    claim: async ({ workerId, now, leaseMs, limit }) => {
      const lockedUntil = new Date(now.getTime() + leaseMs);
      // The inner SELECT locks up to `limit` due rows and skips rows another worker is claiming;
      // the UPDATE takes the lease in the same statement. Clearing the coalescing key lets an
      // event that arrives during the run queue one more job.
      const rows: unknown = await prisma.$queryRaw`
        WITH picked AS (
          SELECT id FROM automation_jobs
          WHERE status = 'pending'
            AND run_at <= ${now}::timestamptz
            AND attempts < max_attempts
            AND (expires_at IS NULL OR expires_at > ${now}::timestamptz)
          ORDER BY run_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE automation_jobs AS job
        SET status = 'processing',
            locked_by = ${workerId},
            locked_until = ${lockedUntil}::timestamptz,
            attempts = job.attempts + 1,
            coalesce_key = NULL,
            updated_at = ${now}::timestamptz
        FROM picked
        WHERE job.id = picked.id
        RETURNING job.id::text AS "id", job.kind AS "kind", job.user_id::text AS "userId",
                  job.payload AS "payload", job.attempts AS "attempts",
                  job.max_attempts AS "maxAttempts", job.expires_at AS "expiresAt"`;
      return z.array(claimedRowSchema).parse(rows);
    },

    complete: async (jobId, workerId, now) => {
      const { count } = await prisma.automationJob.updateMany({
        where: { id: jobId, status: 'processing', lockedBy: workerId },
        data: {
          status: 'succeeded',
          lockedBy: null,
          lockedUntil: null,
          lastErrorCode: null,
          completedAt: now,
          updatedAt: now,
        },
      });
      return count > 0;
    },

    retry: async (jobId, workerId, { at, errorCode }, now) => {
      const { count } = await prisma.automationJob.updateMany({
        where: { id: jobId, status: 'processing', lockedBy: workerId },
        data: {
          status: 'pending',
          runAt: at,
          lockedBy: null,
          lockedUntil: null,
          lastErrorCode: errorCode,
          updatedAt: now,
        },
      });
      return count > 0;
    },

    fail: async (jobId, workerId, errorCode, now) => {
      const { count } = await prisma.automationJob.updateMany({
        where: { id: jobId, status: 'processing', lockedBy: workerId },
        data: {
          status: 'failed',
          lockedBy: null,
          lockedUntil: null,
          lastErrorCode: errorCode,
          completedAt: now,
          updatedAt: now,
        },
      });
      return count > 0;
    },

    recoverExpiredLeases: (now) =>
      prisma.$executeRaw`
        UPDATE automation_jobs
        SET status = (CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END)::automation_job_status,
            completed_at = CASE WHEN attempts >= max_attempts THEN ${now}::timestamptz ELSE NULL END,
            run_at = ${now}::timestamptz,
            locked_by = NULL,
            locked_until = NULL,
            last_error_code = 'lease_expired',
            updated_at = ${now}::timestamptz
        WHERE status = 'processing' AND locked_until < ${now}::timestamptz`,

    expireOverdue: async (now) => {
      const { count } = await prisma.automationJob.updateMany({
        where: { status: 'pending', expiresAt: { lte: now } },
        data: { status: 'expired', coalesceKey: null, completedAt: now, updatedAt: now },
      });
      return count;
    },

    countByStatus: async () => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT status::text AS "status", COUNT(*)::int AS "count"
        FROM automation_jobs GROUP BY status`;
      const counts: Record<AutomationJobStatus, number> = {
        pending: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        expired: 0,
      };
      for (const row of z.array(countRowSchema).parse(rows)) {
        if (isStatus(row.status)) counts[row.status] = row.count;
      }
      return counts;
    },

    requeueFailed: async (now, jobIds) => {
      const { count } = await prisma.automationJob.updateMany({
        where: {
          status: 'failed',
          ...(jobIds === undefined ? {} : { id: { in: [...jobIds] } }),
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: {
          status: 'pending',
          attempts: 0,
          runAt: now,
          completedAt: null,
          updatedAt: now,
        },
      });
      return count;
    },

    deleteFinished: async (before) => {
      const { count } = await prisma.automationJob.deleteMany({
        where: {
          status: { in: ['succeeded', 'failed', 'cancelled', 'expired'] },
          completedAt: { lt: before },
        },
      });
      return count;
    },
  };
}
