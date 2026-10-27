import type { CurrencyCode } from '@calmcash/shared';
import type { RequestHandler } from 'express';

/** Who is calling; provided by the authentication module, never by the request. */
export interface Caller {
  userId: string;
  /** IANA time zone of the user, for "today", calendar-date filters, and opening dates. */
  timeZone: string;
  /** The user's preferred currency: the default for new accounts and the dashboard. */
  preferredCurrency: CurrencyCode;
}

/**
 * What a protected module receives from the authentication module through the composition root
 * (`routes/v1.ts`). Modules never read cookies or import authentication internals.
 */
export interface AuthBoundary {
  /** 401 unless the request carries a valid session. */
  requireSession: RequestHandler;
  /** 403 unless state-changing requests carry the session's CSRF token. */
  requireCsrf: RequestHandler;
  getCaller: (req: object) => Caller;
}

/** Financial data is personal: never cache it anywhere. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
