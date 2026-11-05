import express, { type Request, type RequestHandler } from 'express';
import { z } from 'zod';

import { createRateLimiter, type RateLimitRule, type RateLimitStoreFactory } from './rate-limit';

// Shared plumbing for file uploads. A file is the raw request body (no multipart parsing): the
// size limit is enforced while the body streams in (413 above it), and the content is validated
// by the receiving module, never trusted because of its name or declared type.

/** Reads the raw body, whatever its declared type, up to `limitBytes`. */
export function rawBody(limitBytes: number): RequestHandler {
  return express.raw({ type: () => true, limit: limitBytes });
}

/** The raw body as bytes (an empty body is an empty buffer). */
export const uploadBodySchema = z.custom<Buffer>((value) => Buffer.isBuffer(value), {
  message: 'Send the file as the request body.',
});

export type UploadRateRule = RateLimitRule;

/** Generous for people, tight enough that uploads cannot be used to exhaust the server. */
export const DEFAULT_UPLOAD_RATE: UploadRateRule = { limit: 60, windowMs: 10 * 60 * 1000 };

/** Counts uploads per signed-in user; `name` keeps each upload kind's counter separate. */
export function uploadRateLimit(
  name: string,
  rule: UploadRateRule,
  userIdOf: (req: Request) => string,
  store?: RateLimitStoreFactory,
): RequestHandler {
  return createRateLimiter({
    name,
    rule,
    key: (req) => `upload:${userIdOf(req)}`,
    message: 'Too many uploads. Please wait a few minutes and try again.',
    ...(store === undefined ? {} : { store }),
  });
}
