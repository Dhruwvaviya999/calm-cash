import { once } from 'node:events';

import { Router } from 'express';

import type { PrismaClient } from '../../generated/prisma/client';
import type { AuthBoundary } from '../../lib/auth-boundary';
import type { Logger } from '../../lib/logger';
import { createRateLimiter, type RateLimitStoreFactory } from '../../lib/rate-limit';
import { writeDataExport } from './data-export';

export interface DataExportModuleDependencies {
  prisma: PrismaClient;
  now?: () => Date;
  /** Exports per signed-in user and window. */
  rateLimit?: { limit: number; windowMs: number };
  rateLimitStore?: RateLimitStoreFactory;
}

/** Each export reads every record of the person; a few an hour is plenty. */
export const DEFAULT_DATA_EXPORT_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

/**
 * GET /financial-data — the signed-in person's records as a JSON download (session required;
 * read-only like every other GET, so no CSRF token). Never cached; nothing is stored server-side.
 */
export function createDataExportRouter(
  dependencies: DataExportModuleDependencies,
  auth: AuthBoundary,
  logger: Logger,
): Router {
  const router = Router();
  const now = dependencies.now ?? ((): Date => new Date());

  router.get(
    '/financial-data',
    auth.requireSession,
    createRateLimiter({
      name: 'exports.financialData',
      rule: dependencies.rateLimit ?? DEFAULT_DATA_EXPORT_RATE_LIMIT,
      key: (req) => `user:${auth.getCaller(req).userId}`,
      message: 'You have downloaded your data several times recently. Please try again later.',
      ...(dependencies.rateLimitStore === undefined ? {} : { store: dependencies.rateLimitStore }),
    }),
    async (req, res) => {
      const { userId } = auth.getCaller(req);
      const at = now();
      const date = at.toISOString().slice(0, 10);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="calmcash-export-${date}.json"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        await writeDataExport(
          dependencies.prisma,
          userId,
          {
            write: async (chunk) => {
              if (!res.write(chunk)) await once(res, 'drain');
            },
            closed: () => res.destroyed || req.destroyed,
          },
          at,
        );
        res.end();
      } catch (error: unknown) {
        // Nothing sent yet: the ordinary error response. Otherwise end the stream abruptly so the
        // download is visibly incomplete instead of looking finished.
        if (!res.headersSent) throw error;
        logger.error({ err: error }, 'Data export failed');
        res.destroy();
      }
    },
  );
  return router;
}
