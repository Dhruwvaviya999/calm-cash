import type {
  MarkNotificationsReadInput,
  NotificationDto,
  NotificationListQuery,
  NotificationPageDto,
  NotificationPreferencesDto,
  NotificationsUpdatedDto,
  UnreadNotificationCountDto,
  UpdateNotificationPreferencesInput,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { NotificationsService } from './notifications.service';

interface NotificationParams {
  params: { notificationId: string };
}

export interface NotificationsController {
  list: Handler<{ query: NotificationListQuery }, NotificationPageDto>;
  unreadCount: Handler<object, UnreadNotificationCountDto>;
  markRead: Handler<NotificationParams, NotificationDto>;
  markManyRead: Handler<{ body: MarkNotificationsReadInput }, NotificationsUpdatedDto>;
  markAllRead: Handler<object, NotificationsUpdatedDto>;
  dismiss: Handler<NotificationParams, NotificationsUpdatedDto>;
  preferences: Handler<object, NotificationPreferencesDto>;
  updatePreferences: Handler<
    { body: UpdateNotificationPreferencesInput },
    NotificationPreferencesDto
  >;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createNotificationsController(
  service: NotificationsService,
  getCaller: (req: object) => Caller,
): NotificationsController {
  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    unreadCount: async (_input, req, res) => {
      sendSuccess(res, await service.unreadCount(getCaller(req)));
    },
    markRead: async ({ params }, req, res) => {
      sendSuccess(res, await service.markRead(getCaller(req), params.notificationId));
    },
    markManyRead: async ({ body }, req, res) => {
      sendSuccess(res, await service.markManyRead(getCaller(req), body.ids));
    },
    markAllRead: async (_input, req, res) => {
      sendSuccess(res, await service.markAllRead(getCaller(req)));
    },
    dismiss: async ({ params }, req, res) => {
      sendSuccess(res, await service.dismiss(getCaller(req), params.notificationId));
    },
    preferences: async (_input, req, res) => {
      sendSuccess(res, await service.preferences(getCaller(req)));
    },
    updatePreferences: async ({ body }, req, res) => {
      sendSuccess(res, await service.updatePreferences(getCaller(req), body));
    },
  };
}
