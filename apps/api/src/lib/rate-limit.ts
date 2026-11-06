import { createHash } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit, type Store } from 'express-rate-limit';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client';
import { AppError } from './app-error';

// Abuse limits (sign-in, recovery, uploads, AI, intelligence) share one helper. Counters live in
// a `RateLimitStore`: PostgreSQL in deployed processes, so every API instance (and every
// serverless cold start) sees the same counts, and in process memory for unit tests and when no
// store is supplied. Each limiter has its own name, so identical subjects (one user's receipt and
// statement uploads, say) are counted separately, exactly as with one memory store per limiter.

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

/** Creates the counter store for one named limiter. Names must be unique per application. */
export type RateLimitStoreFactory = (name: string, windowMs: number) => Store;

export interface RateLimiterOptions {
  /** Stable, unique name of the limiter (part of every key). */
  name: string;
  rule: RateLimitRule;
  /** The subject being limited, e.g. `ip:…`, `email:…`, or `user:…`. */
  key: (req: Request) => string;
  /** Shown to the person when the limit is reached. */
  message: string;
  /** Count only requests that fail (4xx/5xx), e.g. wrong passwords. */
  countOnlyFailures?: boolean;
  /** Omitted: an in-memory store for this limiter alone. */
  store?: RateLimitStoreFactory;
}

/** The window end express-rate-limit attached to the request (`req.rateLimit`), if any. */
function resetTimeOf(req: Request): Date | undefined {
  const info: unknown = Reflect.get(req, 'rateLimit');
  return typeof info === 'object' &&
    info !== null &&
    'resetTime' in info &&
    info.resetTime instanceof Date
    ? info.resetTime
    : undefined;
}

export function createRateLimiter({
  name,
  rule,
  key,
  message,
  countOnlyFailures = false,
  store,
}: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: countOnlyFailures,
    keyGenerator: key,
    // A store failure (database unavailable) fails the request instead of letting it through
    // unlimited; the error handler answers with a generic 500 and no details.
    passOnStoreError: false,
    ...(store === undefined ? {} : { store: store(name, rule.windowMs) }),
    handler: (req: Request, res: Response, next: NextFunction) => {
      // The remaining time of this window when known, otherwise the whole window.
      const resetTime = resetTimeOf(req);
      const seconds =
        resetTime === undefined
          ? Math.ceil(rule.windowMs / 1000)
          : Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(seconds));
      next(new AppError(429, 'RATE_LIMITED', message));
    },
  });
}

/** Keys are hashed with the limiter name: no e-mail address or IP is stored. */
export function rateLimitKeyHash(name: string, key: string): string {
  return createHash('sha256').update(`${name}\u0000${key}`).digest('hex');
}

const counterRowSchema = z.object({ hits: z.number().int(), resetAt: z.date() });

/**
 * Shared fixed-window counters in `rate_limit_counters`. One atomic statement per hit: a row past
 * its window restarts at 1, otherwise its count goes up. Times come from the database clock, so
 * instances with skewed clocks agree. Expired rows are removed by the worker's maintenance job.
 */
export function createPostgresRateLimitStores(prisma: PrismaClient): RateLimitStoreFactory {
  return (name, windowMs) => {
    const hashOf = (key: string): string => rateLimitKeyHash(name, key);
    return {
      // Shared between instances; the prefix keeps express-rate-limit's double-count check exact.
      localKeys: false,
      prefix: `${name}:`,
      increment: async (key) => {
        const rows: unknown = await prisma.$queryRaw`
          INSERT INTO rate_limit_counters AS c (key, hits, reset_at)
          VALUES (${hashOf(key)}, 1, now() + make_interval(secs => ${windowMs / 1000}))
          ON CONFLICT (key) DO UPDATE
          SET hits = CASE WHEN c.reset_at <= now() THEN 1 ELSE c.hits + 1 END,
              reset_at = CASE WHEN c.reset_at <= now() THEN EXCLUDED.reset_at ELSE c.reset_at END
          RETURNING c.hits AS "hits", c.reset_at AS "resetAt"`;
        const [row] = z.tuple([counterRowSchema]).parse(rows);
        return { totalHits: row.hits, resetTime: row.resetAt };
      },
      decrement: async (key) => {
        await prisma.$executeRaw`
          UPDATE rate_limit_counters SET hits = hits - 1
          WHERE key = ${hashOf(key)} AND hits > 0 AND reset_at > now()`;
      },
      resetKey: async (key) => {
        await prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE key = ${hashOf(key)}`;
      },
      get: async (key) => {
        const rows: unknown = await prisma.$queryRaw`
          SELECT hits AS "hits", reset_at AS "resetAt" FROM rate_limit_counters
          WHERE key = ${hashOf(key)} AND reset_at > now()`;
        const [row] = z.array(counterRowSchema).max(1).parse(rows);
        return row === undefined ? undefined : { totalHits: row.hits, resetTime: row.resetAt };
      },
    };
  };
}
