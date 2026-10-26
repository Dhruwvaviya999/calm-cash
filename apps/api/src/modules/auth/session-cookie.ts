import { AUTH_TOKEN_PATTERN } from '@calmcash/shared';
import type { CookieOptions, Request, Response } from 'express';

import type { SessionConfig } from '../../config/env';

export type SessionCookieConfig = Pick<SessionConfig, 'cookieName' | 'secureCookie'>;

/**
 * Host-only (no `Domain`), HttpOnly, `Path=/`, and `SameSite=Strict`: the browser sends it only
 * on requests initiated by pages of the same site, never to other hosts, and scripts cannot read
 * it. `Secure` is set in production, where the `__Host-` name prefix makes the browser enforce
 * all of this. The API host is never visited directly, so `Strict` costs no usability.
 */
function baseOptions(config: SessionCookieConfig): CookieOptions {
  return { httpOnly: true, secure: config.secureCookie, sameSite: 'strict', path: '/' };
}

/** Returns the first well-formed session token in the `Cookie` header, if any. */
export function readSessionToken(
  req: Pick<Request, 'get'>,
  config: SessionCookieConfig,
): string | undefined {
  const header = req.get('cookie');
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== config.cookieName) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    if (AUTH_TOKEN_PATTERN.test(value)) {
      return value;
    }
  }
  return undefined;
}

export function setSessionCookie(
  res: Response,
  config: SessionCookieConfig,
  token: string,
  expiresAt: Date,
  now: Date,
): void {
  res.cookie(config.cookieName, token, {
    ...baseOptions(config),
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

export function clearSessionCookie(res: Response, config: SessionCookieConfig): void {
  res.clearCookie(config.cookieName, baseOptions(config));
}
