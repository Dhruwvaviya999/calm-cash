import {
  notificationDtoSchema,
  notificationPageDtoSchema,
  notificationPreferencesDtoSchema,
  notificationsUpdatedDtoSchema,
  unreadNotificationCountDtoSchema,
  type EntityId,
  type NotificationDto,
  type NotificationListFilter,
  type NotificationPageDto,
  type NotificationPreferencesDto,
  type NotificationsUpdatedDto,
  type UnreadNotificationCountDto,
  type UpdateNotificationPreferencesInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per notifications endpoint; every response is validated against the shared schema.
// Notifications are created by CalmCash's background worker; the web app only reads them and
// changes their read state.

function notificationPath(notificationId: EntityId): `/${string}` {
  return `/notifications/${encodeURIComponent(notificationId)}`;
}

export interface NotificationPageRequest {
  status: NotificationListFilter;
  page: number;
  pageSize: number;
}

export function listNotifications(
  { status, page, pageSize }: NotificationPageRequest,
  signal?: AbortSignal,
): Promise<NotificationPageDto> {
  const query = new URLSearchParams({
    status,
    page: String(page),
    pageSize: String(pageSize),
  });
  return api.request(`/notifications?${query.toString()}`, {
    schema: notificationPageDtoSchema,
    signal,
  });
}

export function getUnreadNotificationCount(
  signal?: AbortSignal,
): Promise<UnreadNotificationCountDto> {
  return api.request('/notifications/unread-count', {
    schema: unreadNotificationCountDtoSchema,
    signal,
  });
}

export function markNotificationRead(notificationId: EntityId): Promise<NotificationDto> {
  return api.request(`${notificationPath(notificationId)}/read`, {
    schema: notificationDtoSchema,
    method: 'POST',
  });
}

export function markNotificationsRead(ids: EntityId[]): Promise<NotificationsUpdatedDto> {
  return api.request('/notifications/read', {
    schema: notificationsUpdatedDtoSchema,
    method: 'POST',
    body: { ids },
  });
}

export function markAllNotificationsRead(): Promise<NotificationsUpdatedDto> {
  return api.request('/notifications/read-all', {
    schema: notificationsUpdatedDtoSchema,
    method: 'POST',
  });
}

export function dismissNotification(notificationId: EntityId): Promise<NotificationsUpdatedDto> {
  return api.request(`${notificationPath(notificationId)}/dismiss`, {
    schema: notificationsUpdatedDtoSchema,
    method: 'POST',
  });
}

export function getNotificationPreferences(
  signal?: AbortSignal,
): Promise<NotificationPreferencesDto> {
  return api.request('/notifications/preferences', {
    schema: notificationPreferencesDtoSchema,
    signal,
  });
}

export function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferencesDto> {
  return api.request('/notifications/preferences', {
    schema: notificationPreferencesDtoSchema,
    method: 'PATCH',
    body: input,
  });
}
