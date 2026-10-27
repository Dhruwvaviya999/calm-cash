import {
  createSavingsGoalInputSchema,
  entityIdSchema,
  goalContributionInputSchema,
  savingsGoalListQuerySchema,
  updateSavingsGoalInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createGoalsController } from './goals.controller';
import type { GoalsRepository } from './goals.repository';
import { createGoalsService, type GoalAction } from './goals.service';

export interface GoalsModuleDependencies {
  repository: GoalsRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const goalParams = z.object({ goalId: entityIdSchema });

const ACTIONS: readonly GoalAction[] = [
  'pause',
  'resume',
  'complete',
  'reopen',
  'archive',
  'restore',
];

/**
 * Savings goals. Every route requires a session; state-changing routes also require the CSRF
 * token. Contributions are planning allocations: they never change an account or transaction.
 *
 * GET    /                                list with progress (`status=current|archived|all`)
 * POST   /                                create
 * GET    /:goalId                         details with recent contributions
 * PATCH  /:goalId                         update (partial; `null` clears optional fields)
 * POST   /:goalId/contributions           add, withdraw, or set the tracked amount
 * POST   /:goalId/pause | resume | complete | reopen | archive | restore   lifecycle (idempotent)
 */
export function createGoalsRouter(
  dependencies: GoalsModuleDependencies,
  auth: AuthBoundary,
): Router {
  const service = createGoalsService({
    repository: dependencies.repository,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createGoalsController(service, auth.getCaller);
  const router = Router();
  const params = z.object({ params: goalParams });

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get(
    '/',
    validateRequest(z.object({ query: savingsGoalListQuerySchema }), controller.list),
  );
  router.post(
    '/',
    validateRequest(z.object({ body: createSavingsGoalInputSchema }), controller.create),
  );
  router.get('/:goalId', validateRequest(params, controller.get));
  router.patch(
    '/:goalId',
    validateRequest(
      z.object({ params: goalParams, body: updateSavingsGoalInputSchema }),
      controller.update,
    ),
  );
  router.post(
    '/:goalId/contributions',
    validateRequest(
      z.object({ params: goalParams, body: goalContributionInputSchema }),
      controller.contribute,
    ),
  );
  for (const action of ACTIONS) {
    router.post(`/:goalId/${action}`, validateRequest(params, controller.act(action)));
  }

  return router;
}
