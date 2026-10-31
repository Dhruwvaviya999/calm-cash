'use client';

import type { NotificationDto } from '@calmcash/shared';
import { Check, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  describeAge,
  NOTIFICATION_TYPE_PRESENTATION,
  notificationActionLabel,
  notificationHref,
} from '../notification-presentation';

export interface NotificationItemProps {
  notification: NotificationDto;
  timeZone: string;
  now: Date;
  /** The person followed the link (the notification is then marked read). */
  onOpen: (notification: NotificationDto) => void;
  onMarkRead: (notification: NotificationDto) => void;
  /** Omitted where dismissing is not offered (the compact preview). */
  onDismiss?: (notification: NotificationDto) => void;
  /** Disables the actions while a change is being saved. */
  busy?: boolean;
  compact?: boolean;
}

/**
 * One notification. Unread ones are marked with a text label ("New") and a heavier title, never by
 * colour alone; title and body are plain text, rendered as text.
 */
export function NotificationItem({
  notification,
  timeZone,
  now,
  onOpen,
  onMarkRead,
  onDismiss,
  busy = false,
  compact = false,
}: NotificationItemProps): ReactNode {
  const unread = notification.readAt === undefined;
  const { icon: Icon, label } = NOTIFICATION_TYPE_PRESENTATION[notification.type];
  const titleId = `notification-${notification.id}`;
  const actionClass =
    'inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

  return (
    <article
      aria-labelledby={titleId}
      className={cn('flex gap-3 rounded-xl p-3', unread ? 'bg-accent/50' : 'bg-transparent')}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <h3 id={titleId} className="flex flex-wrap items-baseline gap-x-2 text-sm leading-snug">
          <span className={unread ? 'font-semibold' : 'font-medium'}>{notification.title}</span>
          {unread && (
            <span className="rounded-full bg-primary px-1.5 py-px text-[0.6875rem] font-semibold text-primary-foreground">
              New<span className="sr-only"> (unread)</span>
            </span>
          )}
        </h3>
        <p className={cn('mt-1 text-sm text-muted-foreground', compact && 'line-clamp-2')}>
          {notification.body}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <time
            dateTime={notification.createdAt}
            title={formatDateTime(notification.createdAt, timeZone)}
            className="mr-1 text-muted-foreground"
          >
            {describeAge(notification.createdAt, now, (value) =>
              formatDate(value, 'dayMonthYear', timeZone),
            )}
          </time>
          <Link
            href={notificationHref(notification.target)}
            className={actionClass}
            onClick={() => {
              onOpen(notification);
            }}
          >
            {notificationActionLabel(notification.target)}
          </Link>
          {unread && (
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              aria-label={`Mark as read: ${notification.title}`}
              onClick={() => {
                onMarkRead(notification);
              }}
            >
              <Check aria-hidden="true" className="size-3.5" />
              Mark as read
            </button>
          )}
          {onDismiss !== undefined && (
            <button
              type="button"
              className={cn(actionClass, 'text-muted-foreground')}
              disabled={busy}
              aria-label={`Dismiss: ${notification.title}`}
              onClick={() => {
                onDismiss(notification);
              }}
            >
              <X aria-hidden="true" className="size-3.5" />
              Dismiss
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
