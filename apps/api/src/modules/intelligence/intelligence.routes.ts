import {
  budgetRecommendationsQuerySchema,
  cashFlowForecastQuerySchema,
  entityIdSchema,
  financialHealthQuerySchema,
  intelligenceKeySchema,
  intelligenceOverviewQuerySchema,
  recommendationsQuerySchema,
  scenarioCompareInputSchema,
  scenarioDefinitionInputSchema,
  scenarioListQuerySchema,
  spendingForecastQuerySchema,
  spendingPatternsQuerySchema,
  updateScenarioInputSchema,
  type ApiSuccessResponse,
} from '@calmcash/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../../lib/app-error';
import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { sendSuccess } from '../../lib/http-response';
import { validateRequest } from '../../middleware/validate-request';
import type { IntelligenceRepository } from './intelligence.repository';
import type { IntelligenceService } from './intelligence.service';

export interface IntelligenceModuleDependencies {
  repository: IntelligenceRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Requests per signed-in user and window (in memory, like the other per-user limits). */
  rateLimit?: { limit: number; windowMs: number };
}

/** Generous: every view is a handful of aggregate queries, but none is free. */
export const DEFAULT_INTELLIGENCE_RATE_LIMIT = { limit: 600, windowMs: 10 * 60 * 1000 } as const;

type Reply<K extends keyof IntelligenceService> = Response<
  ApiSuccessResponse<Awaited<ReturnType<IntelligenceService[K]>>>
>;

const noQuery = z.object({ query: z.strictObject({}) });
const scenarioParams = z.object({ scenarioId: entityIdSchema });
const keyParams = z.object({ key: intelligenceKeySchema });

function perUserLimit(
  rule: { limit: number; windowMs: number },
  userIdOf: (req: Request) => string,
): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `intelligence:${userIdOf(req)}`,
    handler: (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a few minutes.'));
    },
  });
}

/**
 * Financial intelligence (read-only calculations, plus saved scenario assumptions). Every route
 * requires a session; changes require the CSRF token; responses are `no-store`; the owner always
 * comes from the session. Nothing here records money or changes a budget, schedule, or goal.
 *
 * GET    /overview                     this month's actual cash flow, money held and owed
 * GET    /cashflow-forecast            projection for 7, 30, 60, or 90 days, per currency
 * GET    /spending-forecast            category estimates for this or next month
 * GET    /spending-patterns            historical analysis for a period
 * GET    /budget-recommendations       suggested limits and budget performance
 * GET    /goal-projections             savings-goal pace and projected completion
 * GET    /financial-health             explainable indicators (no overall score)
 * GET    /recommendations              things worth looking at, with evidence
 * POST   /recommendations/:key/dismiss · /review
 * GET    /scenarios · POST /scenarios  saved what-if scenarios (assumptions only)
 * POST   /scenarios/preview            run an unsaved scenario
 * POST   /scenarios/compare            run up to three saved scenarios
 * GET    /scenarios/:id · PATCH · DELETE
 * POST   /scenarios/:id/run            recalculate a saved scenario now
 */
export function createIntelligenceRouter(
  service: IntelligenceService,
  auth: AuthBoundary,
  rule: { limit: number; windowMs: number } = DEFAULT_INTELLIGENCE_RATE_LIMIT,
): Router {
  const router = Router();
  const caller = (req: object): ReturnType<AuthBoundary['getCaller']> => auth.getCaller(req);
  router.use(auth.requireSession, auth.requireCsrf, noStore);
  router.use(perUserLimit(rule, (req) => caller(req).userId));

  router.get(
    '/overview',
    validateRequest(
      z.object({ query: intelligenceOverviewQuerySchema }),
      async ({ query }, req, res: Reply<'overview'>) => {
        sendSuccess(res, await service.overview(caller(req), query));
      },
    ),
  );
  router.get(
    '/cashflow-forecast',
    validateRequest(
      z.object({ query: cashFlowForecastQuerySchema }),
      async ({ query }, req, res: Reply<'cashFlowForecast'>) => {
        sendSuccess(res, await service.cashFlowForecast(caller(req), query));
      },
    ),
  );
  router.get(
    '/spending-forecast',
    validateRequest(
      z.object({ query: spendingForecastQuerySchema }),
      async ({ query }, req, res: Reply<'spendingForecast'>) => {
        sendSuccess(res, await service.spendingForecast(caller(req), query));
      },
    ),
  );
  router.get(
    '/spending-patterns',
    validateRequest(
      z.object({ query: spendingPatternsQuerySchema }),
      async ({ query }, req, res: Reply<'spendingPatterns'>) => {
        sendSuccess(res, await service.spendingPatterns(caller(req), query));
      },
    ),
  );
  router.get(
    '/budget-recommendations',
    validateRequest(
      z.object({ query: budgetRecommendationsQuerySchema }),
      async ({ query }, req, res: Reply<'budgetRecommendations'>) => {
        sendSuccess(res, await service.budgetRecommendations(caller(req), query));
      },
    ),
  );
  router.get(
    '/goal-projections',
    validateRequest(noQuery, async (_input, req, res: Reply<'goalProjections'>) => {
      sendSuccess(res, await service.goalProjections(caller(req)));
    }),
  );
  router.get(
    '/financial-health',
    validateRequest(
      z.object({ query: financialHealthQuerySchema }),
      async ({ query }, req, res: Reply<'financialHealth'>) => {
        sendSuccess(res, await service.financialHealth(caller(req), query));
      },
    ),
  );
  router.get(
    '/recommendations',
    validateRequest(
      z.object({ query: recommendationsQuerySchema }),
      async ({ query }, req, res: Reply<'recommendations'>) => {
        sendSuccess(res, await service.recommendations(caller(req), query));
      },
    ),
  );
  router.post(
    '/recommendations/:key/dismiss',
    validateRequest(
      z.object({ params: keyParams }),
      async ({ params }, req, res: Reply<'markRecommendation'>) => {
        sendSuccess(res, await service.markRecommendation(caller(req), params.key, 'dismissed'));
      },
    ),
  );
  router.post(
    '/recommendations/:key/review',
    validateRequest(
      z.object({ params: keyParams }),
      async ({ params }, req, res: Reply<'markRecommendation'>) => {
        sendSuccess(res, await service.markRecommendation(caller(req), params.key, 'reviewed'));
      },
    ),
  );

  router.get(
    '/scenarios',
    validateRequest(
      z.object({ query: scenarioListQuerySchema }),
      async ({ query }, req, res: Reply<'listScenarios'>) => {
        sendSuccess(res, await service.listScenarios(caller(req), query));
      },
    ),
  );
  router.post(
    '/scenarios',
    validateRequest(
      z.object({ body: scenarioDefinitionInputSchema }),
      async ({ body }, req, res: Reply<'createScenario'>) => {
        sendSuccess(res, await service.createScenario(caller(req), body), 201);
      },
    ),
  );
  router.post(
    '/scenarios/preview',
    validateRequest(
      z.object({ body: scenarioDefinitionInputSchema }),
      async ({ body }, req, res: Reply<'previewScenario'>) => {
        sendSuccess(res, await service.previewScenario(caller(req), body));
      },
    ),
  );
  router.post(
    '/scenarios/compare',
    validateRequest(
      z.object({ body: scenarioCompareInputSchema }),
      async ({ body }, req, res: Reply<'compareScenarios'>) => {
        sendSuccess(res, await service.compareScenarios(caller(req), body.scenarioIds));
      },
    ),
  );
  router.get(
    '/scenarios/:scenarioId',
    validateRequest(
      z.object({ params: scenarioParams }),
      async ({ params }, req, res: Reply<'getScenario'>) => {
        sendSuccess(res, await service.getScenario(caller(req), params.scenarioId));
      },
    ),
  );
  router.patch(
    '/scenarios/:scenarioId',
    validateRequest(
      z.object({ params: scenarioParams, body: updateScenarioInputSchema }),
      async ({ params, body }, req, res: Reply<'updateScenario'>) => {
        sendSuccess(res, await service.updateScenario(caller(req), params.scenarioId, body));
      },
    ),
  );
  router.delete(
    '/scenarios/:scenarioId',
    validateRequest(z.object({ params: scenarioParams }), async ({ params }, req, res) => {
      await service.deleteScenario(caller(req), params.scenarioId);
      sendSuccess(res, { deleted: true });
    }),
  );
  router.post(
    '/scenarios/:scenarioId/run',
    validateRequest(
      z.object({ params: scenarioParams }),
      async ({ params }, req, res: Reply<'runScenario'>) => {
        sendSuccess(res, await service.runScenario(caller(req), params.scenarioId));
      },
    ),
  );

  return router;
}
