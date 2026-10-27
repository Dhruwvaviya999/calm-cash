import { dashboardQuerySchema, type AccountSummaryDto } from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary, type Caller } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createDashboardController } from './dashboard.controller';
import type { DashboardRepository } from './dashboard.repository';
import { createDashboardService } from './dashboard.service';

export interface DashboardModuleDependencies {
  repository: DashboardRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const request = z.object({ query: dashboardQuerySchema });

/**
 * Read-only analytics; every route requires a session and answers `Cache-Control: no-store`.
 * Query: `period` (preset or `custom` with `from`/`to`) and optional `currency`.
 *
 * GET /overview      position (now), cash flow, savings rate, and comparison for the period
 * GET /trends        income and expenses per calendar bucket of the period
 * GET /categories    spending per top-level category for the period
 */
export function createDashboardRouter(
  dependencies: DashboardModuleDependencies,
  accountSummary: (caller: Caller) => Promise<AccountSummaryDto>,
  auth: AuthBoundary,
): Router {
  const service = createDashboardService({
    repository: dependencies.repository,
    accountSummary,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createDashboardController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);
  router.get('/overview', validateRequest(request, controller.overview));
  router.get('/trends', validateRequest(request, controller.trends));
  router.get('/categories', validateRequest(request, controller.categories));

  return router;
}
