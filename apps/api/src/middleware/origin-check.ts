import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../lib/app-error';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * First CSRF layer for every state-changing request (including login and registration, which have
 * no session yet): browsers attach `Origin` to cross-origin and same-origin POST/PUT/PATCH/DELETE
 * requests, so a value outside the allow-list — or the opaque `"null"` origin — is rejected.
 * Without `Origin`, `Sec-Fetch-Site: cross-site` is rejected too. Requests carrying neither header
 * do not come from a browser and cannot ride on a victim's cookies. CORS alone is not relied on:
 * it hides responses from other origins but does not stop the request from being processed.
 */
export function createOriginCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed: ReadonlySet<string> = new Set(allowedOrigins);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const rejected = origin === undefined ? fetchSite === 'cross-site' : !allowed.has(origin);

    if (rejected) {
      next(
        new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This request did not come from the CalmCash app.'),
      );
      return;
    }
    next();
  };
}
