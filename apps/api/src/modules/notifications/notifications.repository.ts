import type { NotificationListFilter, NotificationType } from '@calmcash/shared';
import { z } from 'zod';

import type {
  Notification,
  NotificationPreference,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import type { PreferenceColumns } from './notification-preferences';

// Database access for the notification center and notification preferences. Every query is
// scoped by the owner's user ID; a notification of another user behaves exactly like a missing
// one. Only notifications created for the center (`in_app`) and not dismissed are ever listed.

export type NotificationRecord = Notification;

export interface NotificationOwner {
  email: string;
  emailVerifiedAt: Date | null;
}

export interface PreferenceChange {
  columns: PreferenceColumns;
  /** Types whose queued e-mails must not go out any more. */
  suppressEmailTypes: readonly NotificationType[];
}

export interface NotificationsRepository {
  page: (
    userId: string,
    filter: NotificationListFilter,
    page: number,
    pageSize: number,
  ) => Promise<{ rows: NotificationRecord[]; total: number }>;
  unreadCount: (userId: string) => Promise<number>;
  find: (userId: string, notificationId: string) => Promise<NotificationRecord | null>;
  /** Marks these of the user's unread notifications read; returns how many changed. */
  markRead: (userId: string, notificationIds: readonly string[], at: Date) => Promise<number>;
  markAllRead: (userId: string, at: Date) => Promise<number>;
  /** Hides one notification from the center (and marks it read); false when not the user's. */
  dismiss: (userId: string, notificationId: string, at: Date) => Promise<boolean>;
  owner: (userId: string) => Promise<NotificationOwner | null>;
  preferences: (userId: string) => Promise<NotificationPreference | null>;
  /**
   * Changes the preferences under a per-user lock (two concurrent saves never lose each other's
   * change) and, in the same transaction, suppresses queued e-mails of the types `change` names
   * (history and in-app notifications are kept).
   */
  updatePreferences: (
    userId: string,
    change: (current: NotificationPreference | null) => PreferenceChange,
    at: Date,
  ) => Promise<NotificationPreference>;
  /** The most recent heartbeat of any worker process. */
  lastWorkerHeartbeat: () => Promise<Date | null>;
}

const countRowSchema = z.object({ count: z.number().int().nonnegative() });

function centerWhere(userId: string): Prisma.NotificationWhereInput {
  return { userId, inApp: true, dismissedAt: null };
}

export function createPrismaNotificationsRepository(prisma: PrismaClient): NotificationsRepository {
  return {
    page: async (userId, filter, page, pageSize) => {
      const where: Prisma.NotificationWhereInput = {
        ...centerWhere(userId),
        ...(filter === 'unread' ? { readAt: null } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.notification.count({ where }),
      ]);
      return { rows, total };
    },

    unreadCount: (userId) =>
      prisma.notification.count({ where: { ...centerWhere(userId), readAt: null } }),

    find: (userId, notificationId) =>
      prisma.notification.findFirst({ where: { ...centerWhere(userId), id: notificationId } }),

    markRead: async (userId, notificationIds, at) => {
      const { count } = await prisma.notification.updateMany({
        where: { ...centerWhere(userId), id: { in: [...notificationIds] }, readAt: null },
        data: { readAt: at },
      });
      return count;
    },

    markAllRead: async (userId, at) => {
      const { count } = await prisma.notification.updateMany({
        where: { ...centerWhere(userId), readAt: null },
        data: { readAt: at },
      });
      return count;
    },

    dismiss: async (userId, notificationId, at) => {
      const rows: unknown = await prisma.$queryRaw`
        WITH changed AS (
          UPDATE notifications
          SET dismissed_at = COALESCE(dismissed_at, ${at}::timestamptz),
              read_at = COALESCE(read_at, ${at}::timestamptz),
              updated_at = ${at}::timestamptz
          WHERE id = ${notificationId}::uuid AND user_id = ${userId}::uuid AND in_app
          RETURNING id
        )
        SELECT COUNT(*)::int AS "count" FROM changed`;
      const [row] = z.array(countRowSchema).parse(rows);
      return (row?.count ?? 0) > 0;
    },

    owner: (userId) =>
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true },
      }),

    preferences: (userId) => prisma.notificationPreference.findUnique({ where: { userId } }),

    updatePreferences: (userId, change, at) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-preferences:${userId}`}, 0))`;
        const { columns, suppressEmailTypes } = change(
          await tx.notificationPreference.findUnique({ where: { userId } }),
        );
        const saved = await tx.notificationPreference.upsert({
          where: { userId },
          create: { userId, ...columns },
          update: columns,
        });
        if (suppressEmailTypes.length > 0) {
          await tx.notificationDelivery.updateMany({
            where: {
              userId,
              status: { in: ['pending', 'retry_scheduled'] },
              notification: { type: { in: [...suppressEmailTypes] } },
            },
            data: { status: 'suppressed', lastErrorCode: 'preference_off', completedAt: at },
          });
        }
        return saved;
      }),

    lastWorkerHeartbeat: async () => {
      const latest = await prisma.workerHeartbeat.findFirst({
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true },
      });
      return latest?.lastSeenAt ?? null;
    },
  };
}
