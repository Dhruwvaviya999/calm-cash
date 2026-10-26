import type { Route } from 'next';

import { NAV_ITEMS } from './navigation';

// Where to send people after they sign in, without ever becoming an open redirect: the requested
// destination survives the trip through /login only if it is exactly one of the app's own
// destinations. Anything else — other hosts, protocol-relative URLs, backslashes, `javascript:`,
// encoded tricks — falls back to the dashboard.

export const DEFAULT_SIGNED_IN_ROUTE: Route = '/dashboard';

/** Query parameter that carries the requested destination to the sign-in page. */
export const RETURN_TO_PARAM = 'next';
/** Query parameter for a short message on the sign-in page. */
export const LOGIN_NOTICE_PARAM = 'notice';

export const LOGIN_NOTICES = ['signed-out', 'session-ended'] as const;
export type LoginNotice = (typeof LOGIN_NOTICES)[number];

/** The matching in-app destination, if `value` is exactly one. */
export function findReturnRoute(value: string | null | undefined): Route | undefined {
  return NAV_ITEMS.find((item) => item.href === value)?.href;
}

export function getSafeReturnPath(value: string | null | undefined): Route {
  return findReturnRoute(value) ?? DEFAULT_SIGNED_IN_ROUTE;
}

export function parseLoginNotice(value: string | null | undefined): LoginNotice | undefined {
  return LOGIN_NOTICES.find((notice) => notice === value);
}

export interface LoginHrefOptions {
  /** The page the user asked for; dropped unless it is a known in-app destination. */
  returnTo?: string | undefined;
  notice?: LoginNotice | undefined;
}

export function buildLoginHref({ returnTo, notice }: LoginHrefOptions = {}): Route {
  const params = new URLSearchParams();
  const destination = findReturnRoute(returnTo);
  if (destination !== undefined && destination !== DEFAULT_SIGNED_IN_ROUTE) {
    params.set(RETURN_TO_PARAM, destination);
  }
  if (notice !== undefined) {
    params.set(LOGIN_NOTICE_PARAM, notice);
  }
  const query = params.toString();
  return query === '' ? '/login' : `/login?${query}`;
}
