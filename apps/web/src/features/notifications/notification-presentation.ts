import {
  notificationLocation,
  type NotificationTargetDto,
  type NotificationType,
} from '@calmcash/shared';
import {
  CalendarClock,
  CalendarX,
  ChartPie,
  Gauge,
  MailWarning,
  MonitorPlay,
  PiggyBank,
  type LucideIcon,
} from 'lucide-react';
import type Link from 'next/link';
import type { ComponentProps } from 'react';

// How notifications look and where they lead. Links are built from the target's identifiers by
// the shared `notificationLocation`, so they always stay inside CalmCash.

export type NotificationHref = ComponentProps<typeof Link>['href'];

export function notificationHref(target: NotificationTargetDto | undefined): NotificationHref {
  const { pathname, query, hash } = notificationLocation(target);
  return { pathname, query, ...(hash === undefined ? {} : { hash }) };
}

/** What following the notification opens, for the link text. */
export function notificationActionLabel(target: NotificationTargetDto | undefined): string {
  switch (target?.kind) {
    case 'budget':
      return 'View budget';
    case 'recurring':
      return 'View payment';
    case 'subscription':
      return 'View subscription';
    case 'dashboard':
      return 'View dashboard';
    case 'notification_settings':
      return 'Notification settings';
    case undefined:
      return 'View notifications';
  }
}

export const NOTIFICATION_TYPE_PRESENTATION: Readonly<
  Record<NotificationType, { icon: LucideIcon; label: string }>
> = {
  budget_approaching_limit: { icon: Gauge, label: 'Budget alert' },
  budget_limit_reached: { icon: PiggyBank, label: 'Budget limit' },
  recurring_payment_upcoming: { icon: CalendarClock, label: 'Upcoming payment' },
  recurring_payment_due: { icon: CalendarClock, label: 'Due today' },
  recurring_payment_overdue: { icon: CalendarX, label: 'Overdue payment' },
  subscription_renewal_upcoming: { icon: MonitorPlay, label: 'Subscription renewal' },
  monthly_summary_ready: { icon: ChartPie, label: 'Monthly summary' },
  email_delivery_problem: { icon: MailWarning, label: 'E-mail delivery' },
};

const relativeFormatter = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", or the date. */
export function describeAge(
  createdAt: string,
  now: Date,
  formatDate: (value: string) => string,
): string {
  const elapsed = now.getTime() - new Date(createdAt).getTime();
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relativeFormatter.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relativeFormatter.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relativeFormatter.format(-Math.floor(elapsed / DAY), 'day');
  return formatDate(createdAt);
}

/** Accessible name of the bell: never a made-up count while it is unknown. */
export function bellLabel(unreadCount: number | undefined): string {
  if (unreadCount === undefined) return 'Notifications';
  if (unreadCount === 0) return 'Notifications, none unread';
  return `Notifications, ${unreadCount.toString()} unread`;
}

/** The badge's text: bounded so it fits. */
export function badgeText(unreadCount: number): string {
  return unreadCount > 99 ? '99+' : unreadCount.toString();
}
