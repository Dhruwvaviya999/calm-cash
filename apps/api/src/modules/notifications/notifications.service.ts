import type {
  NotificationDto,
  NotificationListQuery,
  NotificationPageDto,
  NotificationPreferencesDto,
  NotificationsUpdatedDto,
  UnreadNotificationCountDto,
  UpdateNotificationPreferencesInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import {
  applyPreferencePatch,
  emailTurnedOff,
  resolvePreferences,
  toPreferenceColumns,
  typesOf,
  type ResolvedPreferences,
} from './notification-preferences';
import { toNotificationDto } from './notifications.mapper';
import type { NotificationsRepository } from './notifications.repository';

export interface NotificationsService {
  list: (caller: Caller, query: NotificationListQuery) => Promise<NotificationPageDto>;
  unreadCount: (caller: Caller) => Promise<UnreadNotificationCountDto>;
  markRead: (caller: Caller, notificationId: string) => Promise<NotificationDto>;
  markManyRead: (caller: Caller, ids: readonly string[]) => Promise<NotificationsUpdatedDto>;
  markAllRead: (caller: Caller) => Promise<NotificationsUpdatedDto>;
  dismiss: (caller: Caller, notificationId: string) => Promise<NotificationsUpdatedDto>;
  preferences: (caller: Caller) => Promise<NotificationPreferencesDto>;
  updatePreferences: (
    caller: Caller,
    input: UpdateNotificationPreferencesInput,
  ) => Promise<NotificationPreferencesDto>;
}

export interface NotificationsServiceDependencies {
  repository: NotificationsRepository;
  now: () => Date;
}

/**
 * A worker that has not checked in for this long is reported as not running. Workers refresh
 * their heartbeat at least every minute while they work.
 */
export const WORKER_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

// The same answer for "does not exist" and "belongs to someone else", so IDs reveal nothing.
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That notification does not exist or is not yours.');

export function createNotificationsService({
  repository,
  now,
}: NotificationsServiceDependencies): NotificationsService {
  const updated = async (
    caller: Caller,
    updatedCount: number,
  ): Promise<NotificationsUpdatedDto> => ({
    updatedCount,
    unreadCount: await repository.unreadCount(caller.userId),
  });

  const toPreferencesDto = async (
    caller: Caller,
    preferences: ResolvedPreferences,
  ): Promise<NotificationPreferencesDto> => {
    const [owner, heartbeat] = await Promise.all([
      repository.owner(caller.userId),
      repository.lastWorkerHeartbeat(),
    ]);
    if (owner === null) {
      throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
    }
    const running =
      heartbeat !== null && now().getTime() - heartbeat.getTime() <= WORKER_HEARTBEAT_STALE_MS;
    return {
      channels: preferences.channels,
      paymentLeadDays: preferences.paymentLeadDays,
      subscriptionLeadDays: preferences.subscriptionLeadDays,
      includeRecurringIncome: preferences.includeRecurringIncome,
      email: { address: owner.email, verified: owner.emailVerifiedAt !== null },
      automation: running
        ? { status: 'running', lastSeenAt: heartbeat.toISOString() }
        : {
            status: 'not_running',
            ...(heartbeat === null ? {} : { lastSeenAt: heartbeat.toISOString() }),
          },
      ...(preferences.updatedAt === undefined
        ? {}
        : { updatedAt: preferences.updatedAt.toISOString() }),
    };
  };

  return {
    list: async (caller, { status, page, pageSize }) => {
      const [{ rows, total }, unreadCount] = await Promise.all([
        repository.page(caller.userId, status, page, pageSize),
        repository.unreadCount(caller.userId),
      ]);
      return {
        items: rows.map(toNotificationDto),
        pagination: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) },
        unreadCount,
      };
    },

    unreadCount: async (caller) => ({ unreadCount: await repository.unreadCount(caller.userId) }),

    markRead: async (caller, notificationId) => {
      await repository.markRead(caller.userId, [notificationId], now());
      const row = await repository.find(caller.userId, notificationId);
      if (row === null) {
        throw notFound();
      }
      return toNotificationDto(row);
    },

    markManyRead: async (caller, ids) =>
      updated(caller, await repository.markRead(caller.userId, ids, now())),

    markAllRead: async (caller) =>
      updated(caller, await repository.markAllRead(caller.userId, now())),

    dismiss: async (caller, notificationId) => {
      if (!(await repository.dismiss(caller.userId, notificationId, now()))) {
        throw notFound();
      }
      return updated(caller, 1);
    },

    preferences: async (caller) =>
      toPreferencesDto(caller, resolvePreferences(await repository.preferences(caller.userId))),

    updatePreferences: async (caller, input) => {
      const saved = await repository.updatePreferences(
        caller.userId,
        (current) => {
          const before = resolvePreferences(current);
          const after = applyPreferencePatch(before, input);
          return {
            columns: toPreferenceColumns(after),
            suppressEmailTypes: typesOf(emailTurnedOff(before, after)),
          };
        },
        now(),
      );
      return toPreferencesDto(caller, resolvePreferences(saved));
    },
  };
}
