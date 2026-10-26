import {
  createCategoryInputSchema,
  entityIdSchema,
  updateCategoryInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createCategoriesController } from './categories.controller';
import type { CategoriesRepository } from './categories.repository';
import { createCategoriesService } from './categories.service';

export interface CategoriesModuleDependencies {
  repository: CategoriesRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const categoryParams = z.object({ categoryId: entityIdSchema });

/**
 * Every route requires a session; state-changing routes also require the CSRF token.
 *
 * GET    /                       the user's categories (defaults are created on first use)
 * POST   /                       create a custom category or subcategory
 * PATCH  /:categoryId            rename
 * POST   /:categoryId/archive    archive, with its subcategories (idempotent)
 * POST   /:categoryId/restore    restore (idempotent)
 */
export function createCategoriesRouter(
  dependencies: CategoriesModuleDependencies,
  auth: AuthBoundary,
): Router {
  const service = createCategoriesService({
    repository: dependencies.repository,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createCategoriesController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get('/', controller.list);
  router.post(
    '/',
    validateRequest(z.object({ body: createCategoryInputSchema }), controller.create),
  );
  router.patch(
    '/:categoryId',
    validateRequest(
      z.object({ params: categoryParams, body: updateCategoryInputSchema }),
      controller.rename,
    ),
  );
  router.post(
    '/:categoryId/archive',
    validateRequest(z.object({ params: categoryParams }), controller.archive),
  );
  router.post(
    '/:categoryId/restore',
    validateRequest(z.object({ params: categoryParams }), controller.restore),
  );

  return router;
}
