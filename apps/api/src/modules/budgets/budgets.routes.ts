import {
  budgetDetailQuerySchema,
  budgetListQuerySchema,
  budgetSummaryQuerySchema,
  createBudgetInputSchema,
  entityIdSchema,
  updateBudgetInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createBudgetsController } from './budgets.controller';
import type { BudgetsRepository } from './budgets.repository';
import { createBudgetsService } from './budgets.service';

export interface BudgetsModuleDependencies {
  repository: BudgetsRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const budgetParams = z.object({ budgetId: entityIdSchema });

/**
 * Every route requires a session; state-changing routes also require the CSRF token. Spending is
 * aggregated from the ledger on every request, for the period containing `?date=` (default:
 * today in the user's time zone).
 *
 * GET    /                      list with progress (`status`, `period`, `categoryId`, `currency`, `date`)
 * GET    /summary               status counts, totals per cadence, and highlights for one currency
 * POST   /                      create
 * GET    /:budgetId             one budget with its progress (`?date=`)
 * PATCH  /:budgetId             update (partial; `null` clears optional fields)
 * POST   /:budgetId/archive     archive (idempotent)
 * POST   /:budgetId/restore     restore (idempotent)
 */
export function createBudgetsRouter(
  dependencies: BudgetsModuleDependencies,
  auth: AuthBoundary,
): Router {
  const service = createBudgetsService({
    repository: dependencies.repository,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createBudgetsController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get('/', validateRequest(z.object({ query: budgetListQuerySchema }), controller.list));
  router.get(
    '/summary',
    validateRequest(z.object({ query: budgetSummaryQuerySchema }), controller.summary),
  );
  router.post('/', validateRequest(z.object({ body: createBudgetInputSchema }), controller.create));
  router.get(
    '/:budgetId',
    validateRequest(
      z.object({ params: budgetParams, query: budgetDetailQuerySchema }),
      controller.get,
    ),
  );
  router.patch(
    '/:budgetId',
    validateRequest(
      z.object({ params: budgetParams, body: updateBudgetInputSchema }),
      controller.update,
    ),
  );
  router.post(
    '/:budgetId/archive',
    validateRequest(z.object({ params: budgetParams }), controller.archive),
  );
  router.post(
    '/:budgetId/restore',
    validateRequest(z.object({ params: budgetParams }), controller.restore),
  );

  return router;
}
