import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from './app-error';

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

export interface UploadRateRule {
  limit: number;
  windowMs: number;
}

/** Generous for people, tight enough that uploads cannot be used to exhaust the server. */
export const DEFAULT_UPLOAD_RATE: UploadRateRule = { limit: 60, windowMs: 10 * 60 * 1000 };

/** Counts uploads per signed-in user (in memory; see the auth rate limits for scaling notes). */
export function uploadRateLimit(
  rule: UploadRateRule,
  userIdOf: (req: Request) => string,
): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `upload:${userIdOf(req)}`,
    handler: (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many uploads. Please wait a few minutes and try again.',
        ),
      );
    },
  });
}
