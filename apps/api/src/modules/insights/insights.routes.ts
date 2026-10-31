import { insightKeySchema, insightQuerySchema } from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { sendSuccess } from '../../lib/http-response';
import { validateRequest } from '../../middleware/validate-request';
import type { InsightsService } from './insights.service';

const keyParams = z.object({ key: insightKeySchema });

/**
 * Deterministic insights: patterns and recurring-payment candidates computed from the signed-in
 * user's own records. No AI is involved, so these work with AI turned off or unavailable.
 *
 * GET  /                                  insights for a period (`period`, `from`, `to`, `currency`)
 * POST /:key/dismiss                      hide one insight
 * GET  /recurring-candidates              possible recurring payments not yet scheduled
 * POST /recurring-candidates/:key/dismiss ignore a candidate
 */
export function createInsightsRouter(service: InsightsService, auth: AuthBoundary): Router {
  const router = Router();
  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get(
    '/',
    validateRequest(z.object({ query: insightQuerySchema }), async ({ query }, req, res) => {
      sendSuccess(res, await service.list(auth.getCaller(req), query));
    }),
  );
  router.get(
    '/recurring-candidates',
    validateRequest(z.object({ query: z.strictObject({}) }), async (_input, req, res) => {
      sendSuccess(res, await service.recurringCandidates(auth.getCaller(req)));
    }),
  );
  router.post(
    '/recurring-candidates/:key/dismiss',
    validateRequest(z.object({ params: keyParams }), async ({ params }, req, res) => {
      await service.dismissCandidate(auth.getCaller(req), params.key);
      sendSuccess(res, { dismissed: true });
    }),
  );
  router.post(
    '/:key/dismiss',
    validateRequest(z.object({ params: keyParams }), async ({ params }, req, res) => {
      await service.dismissInsight(auth.getCaller(req), params.key);
      sendSuccess(res, { dismissed: true });
    }),
  );
  return router;
}
