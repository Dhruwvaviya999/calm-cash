import type { NotificationDeliveryStatus } from '@calmcash/shared';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client';

// The e-mail outbox: one `notification_deliveries` row per notification sent by e-mail. Claiming
// works like the job queue (`FOR UPDATE SKIP LOCKED`, a lease, fenced completion); the SMTP
// conversation happens after the claim has committed, so no database transaction waits on a mail
// server. Rows are never deleted when delivery fails — their status and error code stay for
// diagnosis until retention removes them.

export interface ClaimedDelivery {
  id: string;
  notificationId: string;
  userId: string;
  /** Including the current one. */
  attempts: number;
  maxAttempts: number;
  expiresAt: Date | null;
}

export interface DeliveryClaimOptions {
  workerId: string;
  now: Date;
  leaseMs: number;
  limit: number;
}

export interface DeliveryStore {
  claim: (options: DeliveryClaimOptions) => Promise<ClaimedDelivery[]>;
  /** Each of these returns false when the lease was lost (nothing is changed then). */
  markSent: (deliveryId: string, workerId: string, now: Date) => Promise<boolean>;
  scheduleRetry: (
    deliveryId: string,
    workerId: string,
    retry: { at: Date; errorCode: string; uncertain: boolean },
    now: Date,
  ) => Promise<boolean>;
  markFailed: (
    deliveryId: string,
    workerId: string,
    failure: { errorCode: string; uncertain: boolean },
    now: Date,
  ) => Promise<boolean>;
  markSuppressed: (
    deliveryId: string,
    workerId: string,
    reason: string,
    now: Date,
  ) => Promise<boolean>;
  /**
   * Hands back a claimed delivery this worker never attempted (it is shutting down): due again at
   * once with the claim's attempt returned. Nothing was sent, so the outcome stays certain.
   */
  release: (deliveryId: string, workerId: string, now: Date) => Promise<boolean>;
  /**
   * Deliveries whose worker vanished mid-attempt. The mail server may have accepted the message,
   * so they are flagged `outcome_uncertain` before being retried (or failed when out of attempts).
   */
  recoverExpiredLeases: (now: Date) => Promise<number>;
  /**
   * Deliveries past their expiry: never attempted ones are suppressed, retrying ones failed. An
   * out-of-date reminder is never sent late as if it were still upcoming.
   */
  expireOverdue: (now: Date) => Promise<number>;
  countByStatus: () => Promise<Record<NotificationDeliveryStatus, number>>;
  /** Retention: removes finished deliveries completed before `before`. */
  deleteFinished: (before: Date) => Promise<number>;
}

const claimedRowSchema = z.object({
  id: z.string(),
  notificationId: z.string(),
  userId: z.string(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  expiresAt: z.date().nullable(),
});

const countRowSchema = z.object({ status: z.string(), count: z.number().int() });

const STATUSES: readonly NotificationDeliveryStatus[] = [
  'pending',
  'processing',
  'sent',
  'retry_scheduled',
  'failed',
  'suppressed',
];

function isStatus(value: string): value is NotificationDeliveryStatus {
  return STATUSES.some((status) => status === value);
}

export function createPrismaDeliveryStore(prisma: PrismaClient): DeliveryStore {
  const finish = async (
    deliveryId: string,
    workerId: string,
    data: {
      status: 'sent' | 'failed' | 'suppressed';
      lastErrorCode: string | null;
      outcomeUncertain?: boolean;
      sentAt?: Date;
    },
    now: Date,
  ): Promise<boolean> => {
    const { count } = await prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, status: 'processing', lockedBy: workerId },
      data: { ...data, lockedBy: null, lockedUntil: null, completedAt: now, updatedAt: now },
    });
    return count > 0;
  };

  return {
    claim: async ({ workerId, now, leaseMs, limit }) => {
      const lockedUntil = new Date(now.getTime() + leaseMs);
      const rows: unknown = await prisma.$queryRaw`
        WITH picked AS (
          SELECT id FROM notification_deliveries
          WHERE status IN ('pending', 'retry_scheduled')
            AND next_attempt_at <= ${now}::timestamptz
            AND attempts < max_attempts
            AND (expires_at IS NULL OR expires_at > ${now}::timestamptz)
          ORDER BY next_attempt_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notification_deliveries AS delivery
        SET status = 'processing',
            locked_by = ${workerId},
            locked_until = ${lockedUntil}::timestamptz,
            attempts = delivery.attempts + 1,
            updated_at = ${now}::timestamptz
        FROM picked
        WHERE delivery.id = picked.id
        RETURNING delivery.id::text AS "id", delivery.notification_id::text AS "notificationId",
                  delivery.user_id::text AS "userId", delivery.attempts AS "attempts",
                  delivery.max_attempts AS "maxAttempts", delivery.expires_at AS "expiresAt"`;
      return z.array(claimedRowSchema).parse(rows);
    },

    release: async (deliveryId, workerId, now) => {
      const count = await prisma.$executeRaw`
        UPDATE notification_deliveries
        SET status = (CASE WHEN attempts > 1 THEN 'retry_scheduled' ELSE 'pending' END)::notification_delivery_status,
            attempts = GREATEST(attempts - 1, 0),
            locked_by = NULL,
            locked_until = NULL,
            updated_at = ${now}::timestamptz
        WHERE id = ${deliveryId}::uuid AND status = 'processing' AND locked_by = ${workerId}`;
      return count > 0;
    },

    markSent: (deliveryId, workerId, now) =>
      finish(deliveryId, workerId, { status: 'sent', lastErrorCode: null, sentAt: now }, now),

    scheduleRetry: async (deliveryId, workerId, { at, errorCode, uncertain }, now) => {
      const { count } = await prisma.notificationDelivery.updateMany({
        where: { id: deliveryId, status: 'processing', lockedBy: workerId },
        data: {
          status: 'retry_scheduled',
          nextAttemptAt: at,
          lockedBy: null,
          lockedUntil: null,
          lastErrorCode: errorCode,
          ...(uncertain ? { outcomeUncertain: true } : {}),
          updatedAt: now,
        },
      });
      return count > 0;
    },

    markFailed: (deliveryId, workerId, { errorCode, uncertain }, now) =>
      finish(
        deliveryId,
        workerId,
        {
          status: 'failed',
          lastErrorCode: errorCode,
          ...(uncertain ? { outcomeUncertain: true } : {}),
        },
        now,
      ),

    markSuppressed: (deliveryId, workerId, reason, now) =>
      finish(deliveryId, workerId, { status: 'suppressed', lastErrorCode: reason }, now),

    recoverExpiredLeases: (now) =>
      prisma.$executeRaw`
        UPDATE notification_deliveries
        SET status = (CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry_scheduled' END)::notification_delivery_status,
            completed_at = CASE WHEN attempts >= max_attempts THEN ${now}::timestamptz ELSE NULL END,
            next_attempt_at = ${now}::timestamptz,
            locked_by = NULL,
            locked_until = NULL,
            outcome_uncertain = TRUE,
            last_error_code = 'lease_expired',
            updated_at = ${now}::timestamptz
        WHERE status = 'processing' AND locked_until < ${now}::timestamptz`,

    expireOverdue: async (now) => {
      const [suppressed, failed] = await prisma.$transaction([
        prisma.notificationDelivery.updateMany({
          where: { status: 'pending', expiresAt: { lte: now } },
          data: {
            status: 'suppressed',
            lastErrorCode: 'expired',
            completedAt: now,
            updatedAt: now,
          },
        }),
        prisma.notificationDelivery.updateMany({
          where: { status: 'retry_scheduled', expiresAt: { lte: now } },
          data: {
            status: 'failed',
            lastErrorCode: 'expired_while_retrying',
            completedAt: now,
            updatedAt: now,
          },
        }),
      ]);
      return suppressed.count + failed.count;
    },

    countByStatus: async () => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT status::text AS "status", COUNT(*)::int AS "count"
        FROM notification_deliveries GROUP BY status`;
      const counts: Record<NotificationDeliveryStatus, number> = {
        pending: 0,
        processing: 0,
        sent: 0,
        retry_scheduled: 0,
        failed: 0,
        suppressed: 0,
      };
      for (const row of z.array(countRowSchema).parse(rows)) {
        if (isStatus(row.status)) counts[row.status] = row.count;
      }
      return counts;
    },

    deleteFinished: async (before) => {
      const { count } = await prisma.notificationDelivery.deleteMany({
        where: { status: { in: ['sent', 'failed', 'suppressed'] }, completedAt: { lt: before } },
      });
      return count;
    },
  };
}
