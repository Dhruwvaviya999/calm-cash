import { emailAddressSchema } from '@calmcash/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { AppError } from '../../lib/app-error';
import { getAuthContext } from './auth.middleware';

// Abuse limits for the authentication endpoints. Counters live in process memory (one store per
// limiter): with several API instances each keeps its own counts, so the effective limit is
// multiplied by the instance count — move to a shared store (e.g. Redis) before scaling out.

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

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

function createLimiter(
  rule: RateLimitRule,
  strategy: KeyStrategy,
  options: { countOnlyFailures?: boolean } = {},
): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: options.countOnlyFailures ?? false,
    keyGenerator: (req: Request) => keyFor(strategy, req),
    handler: (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many attempts. Please wait a few minutes and try again.',
        ),
      );
    },
  });
}

export interface AuthRateLimiters {
  login: RequestHandler[];
  register: RequestHandler[];
  verifyEmail: RequestHandler[];
  resendVerification: RequestHandler[];
  forgotPassword: RequestHandler[];
  resetPassword: RequestHandler[];
  changePassword: RequestHandler[];
}

/** Builds fresh limiters (with their own counters) for one application instance. */
export function createAuthRateLimiters(limits: Readonly<AuthRateLimits>): AuthRateLimiters {
  return {
    login: [
      createLimiter(limits.loginPerIp, 'ip', { countOnlyFailures: true }),
      createLimiter(limits.loginPerEmail, 'email', { countOnlyFailures: true }),
    ],
    register: [createLimiter(limits.registerPerIp, 'ip')],
    verifyEmail: [createLimiter(limits.verifyEmailPerIp, 'ip')],
    resendVerification: [
      createLimiter(limits.resendVerificationPerIp, 'ip'),
      createLimiter(limits.resendVerificationPerEmail, 'email'),
    ],
    forgotPassword: [
      createLimiter(limits.forgotPasswordPerIp, 'ip'),
      createLimiter(limits.forgotPasswordPerEmail, 'email'),
    ],
    resetPassword: [createLimiter(limits.resetPasswordPerIp, 'ip')],
    changePassword: [createLimiter(limits.changePasswordPerUser, 'user')],
  };
}
