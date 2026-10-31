import {
  NOTIFICATION_TYPE_CATEGORY,
  notificationTargetDtoSchema,
  type NotificationDto,
  type NotificationTargetDto,
} from '@calmcash/shared';

import type { NotificationRecord } from './notifications.repository';

/** A stored target, or `undefined` when it is absent or no longer matches the contract. */
export function readTarget(value: unknown): NotificationTargetDto | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = notificationTargetDtoSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function toNotificationDto(row: NotificationRecord): NotificationDto {
  const category = NOTIFICATION_TYPE_CATEGORY[row.type];
  const target = readTarget(row.target);
  return {
    id: row.id,
    type: row.type,
    ...(category === null ? {} : { category }),
    title: row.title,
    body: row.body,
    ...(target === undefined ? {} : { target }),
    createdAt: row.createdAt.toISOString(),
    ...(row.readAt === null ? {} : { readAt: row.readAt.toISOString() }),
  };
}
