import { emailAddressSchema } from '@calmcash/shared';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

import {
  createRateLimiter,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from '../../lib/rate-limit';
import { getAuthContext } from './auth.middleware';

// Abuse limits for the authentication endpoints. Counters live in the store supplied by the
// composition root: PostgreSQL in deployed processes, so limits hold across API instances and
// restarts; process memory when no store is given (unit tests).

export type { RateLimitRule } from '../../lib/rate-limit';

export interface AuthRateLimits {
  /** Failed sign-ins per client IP. */
  loginPerIp: RateLimitRule;
  /** Failed sign-ins per e-mail address (normalised), whichever IP they come from. */
  loginPerEmail: RateLimitRule;
  registerPerIp: RateLimitRule;
  verifyEmailPerIp: RateLimitRule;
  resendVerificationPerIp: RateLimitRule;
  resendVerificationPerEmail: RateLimitRule;
  forgotPasswordPerIp: RateLimitRule;
  forgotPasswordPerEmail: RateLimitRule;
  resetPasswordPerIp: RateLimitRule;
  /** Password-change attempts per signed-in user (guards the current-password check). */
  changePasswordPerUser: RateLimitRule;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Generous enough for people who mistype, strict enough to make guessing and spamming slow. */
export const DEFAULT_AUTH_RATE_LIMITS: Readonly<AuthRateLimits> = {
  loginPerIp: { limit: 30, windowMs: 15 * MINUTE_MS },
  loginPerEmail: { limit: 10, windowMs: 15 * MINUTE_MS },
  registerPerIp: { limit: 10, windowMs: HOUR_MS },
  verifyEmailPerIp: { limit: 30, windowMs: HOUR_MS },
  resendVerificationPerIp: { limit: 10, windowMs: HOUR_MS },
  resendVerificationPerEmail: { limit: 5, windowMs: HOUR_MS },
  forgotPasswordPerIp: { limit: 10, windowMs: HOUR_MS },
  forgotPasswordPerEmail: { limit: 5, windowMs: HOUR_MS },
  resetPasswordPerIp: { limit: 20, windowMs: HOUR_MS },
  changePasswordPerUser: { limit: 10, windowMs: HOUR_MS },
};

type KeyStrategy = 'ip' | 'email' | 'user';

function ipKey(req: Request): string {
  // `req.ip` honours the configured `trust proxy` hops; IPv6 clients are grouped by /56 subnet.
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/** The normalised address, so `A@x.com` and ` a@x.com` share one counter. */
function emailKey(req: Request): string {
  const body: unknown = req.body;
  const raw = typeof body === 'object' && body !== null && 'email' in body ? body.email : undefined;
  const parsed = emailAddressSchema.safeParse(raw);
  return parsed.success ? `email:${parsed.data}` : ipKey(req);
}

function keyFor(strategy: KeyStrategy, req: Request): string {
  switch (strategy) {
    case 'ip':
      return ipKey(req);
    case 'email':
      return emailKey(req);
    case 'user':
      return `user:${getAuthContext(req).user.id}`;
  }
}

const LIMITED_MESSAGE = 'Too many attempts. Please wait a few minutes and try again.';

export interface AuthRateLimiters {
  login: RequestHandler[];
  register: RequestHandler[];
  verifyEmail: RequestHandler[];
  resendVerification: RequestHandler[];
  forgotPassword: RequestHandler[];
  resetPassword: RequestHandler[];
  changePassword: RequestHandler[];
}

/** Builds the limiters for one application instance; `store` shares their counters. */
export function createAuthRateLimiters(
  limits: Readonly<AuthRateLimits>,
  store?: RateLimitStoreFactory,
): AuthRateLimiters {
  const limiter = (
    name: keyof AuthRateLimits,
    strategy: KeyStrategy,
    options: { countOnlyFailures?: boolean } = {},
  ): RequestHandler =>
    createRateLimiter({
      name: `auth.${name}`,
      rule: limits[name],
      key: (req) => keyFor(strategy, req),
      message: LIMITED_MESSAGE,
      ...options,
      ...(store === undefined ? {} : { store }),
    });
  return {
    login: [
      limiter('loginPerIp', 'ip', { countOnlyFailures: true }),
      limiter('loginPerEmail', 'email', { countOnlyFailures: true }),
    ],
    register: [limiter('registerPerIp', 'ip')],
    verifyEmail: [limiter('verifyEmailPerIp', 'ip')],
    resendVerification: [
      limiter('resendVerificationPerIp', 'ip'),
      limiter('resendVerificationPerEmail', 'email'),
    ],
    forgotPassword: [
      limiter('forgotPasswordPerIp', 'ip'),
      limiter('forgotPasswordPerEmail', 'email'),
    ],
    resetPassword: [limiter('resetPasswordPerIp', 'ip')],
    changePassword: [limiter('changePasswordPerUser', 'user')],
  };
}
