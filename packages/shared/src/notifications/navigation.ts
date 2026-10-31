import type { NotificationTargetDto } from '../types/notification';

// Where a notification leads, as an app path plus query parameters built from the target's
// identifiers. The web app turns it into a link and the worker into an e-mail link, so both always
// point at the same place — and since a target holds only validated identifiers, a stored
// notification can never link outside CalmCash.

export type NotificationPathname = '/budgets' | '/dashboard' | '/settings' | '/notifications';

export interface NotificationLocation {
  pathname: NotificationPathname;
  query: Record<string, string>;
  /** Fragment without `#`. */
  hash?: string;
}

export function notificationLocation(
  target: NotificationTargetDto | undefined,
): NotificationLocation {
  if (target === undefined) {
    return { pathname: '/notifications', query: {} };
  }
  switch (target.kind) {
    case 'budget':
      return { pathname: '/budgets', query: { budget: target.budgetId } };
    case 'recurring':
      return { pathname: '/budgets', query: { section: 'recurring', schedule: target.scheduleId } };
    case 'subscription':
      return {
        pathname: '/budgets',
        query: { section: 'subscriptions', schedule: target.scheduleId },
      };
    case 'dashboard':
      return {
        pathname: '/dashboard',
        query: { period: 'custom', from: target.from, to: target.to, currency: target.currency },
      };
    case 'notification_settings':
      return { pathname: '/settings', query: {}, hash: 'notifications' };
  }
}

/** `pathname?query#hash`, relative to the web app's origin. */
export function notificationHref(target: NotificationTargetDto | undefined): string {
  const location = notificationLocation(target);
  const query = Object.entries(location.query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${location.pathname}${query === '' ? '' : `?${query}`}${
    location.hash === undefined ? '' : `#${location.hash}`
  }`;
}
