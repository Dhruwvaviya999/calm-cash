import { CSRF_TOKEN_HEADER } from '@calmcash/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../../lib/app-error';
import type { AuthContext, AuthService } from './auth.service';
import { clearSessionCookie, readSessionToken, type SessionCookieConfig } from './session-cookie';

// The authenticated-user boundary. Route handlers obtain the caller exclusively through
// `getAuthContext(req)`; a user ID supplied by the client is never used to decide who is calling.

const contexts = new WeakMap<object, AuthContext>();

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The caller resolved by `requireSession`. Throws 401 if the middleware did not run. */
export function getAuthContext(req: object): AuthContext {
  const context = contexts.get(req);
  if (context === undefined) {
    throw new AppError(401, 'UNAUTHORIZED', 'You are not signed in, or your session has ended.');
  }
  return context;
}

/**
 * Accepts the request only with a valid session cookie: known, not revoked, not expired, not idle
 * too long, and belonging to a verified user. A cookie that fails these checks is cleared.
 */
export function createRequireSession(
  service: AuthService,
  cookie: SessionCookieConfig,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readSessionToken(req, cookie);
    const context = token === undefined ? null : await service.authenticate(token);
    if (context === null) {
      if (token !== undefined) {
        clearSessionCookie(res, cookie);
      }
      throw new AppError(401, 'UNAUTHORIZED', 'You are not signed in, or your session has ended.');
    }
    contexts.set(req, context);
    next();
  };
}

/**
 * Synchronizer-token check for state-changing requests on an authenticated route: the
 * `x-csrf-token` header must match the token bound to the caller's session. Cross-site pages can
 * make the browser send the cookie, but they can never read the token. Mount after
 * `requireSession`.
 */
export function createRequireCsrf(service: AuthService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (!service.isValidCsrfToken(getAuthContext(req), req.get(CSRF_TOKEN_HEADER))) {
      throw new AppError(
        403,
        'CSRF_TOKEN_INVALID',
        'The security token of this request is missing or out of date. Refresh the page and try again.',
      );
    }
    next();
  };
}
