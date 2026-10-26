import {
  accountListQuerySchema,
  createAccountInputSchema,
  entityIdSchema,
  updateAccountInputSchema,
} from '@calmcash/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import { validateRequest } from '../../middleware/validate-request';
import { createAccountsController } from './accounts.controller';
import type { AccountsRepository } from './accounts.repository';
import { createAccountsService, type Caller } from './accounts.service';

export interface AccountsModuleDependencies {
  repository: AccountsRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** Supplied by the authentication module through the composition root. */
export interface AccountsAuthBoundary {
  requireSession: RequestHandler;
  requireCsrf: RequestHandler;
  getCaller: (req: object) => Caller;
}

const accountParams = z.object({ accountId: entityIdSchema });

/**
 * Every route requires a session; state-changing routes also require the session's CSRF token.
 *
 * GET    /                      list (`?status=active|archived|all`, `?type=`)
 * GET    /summary               totals of active accounts per currency
 * POST   /                      create
 * GET    /:accountId            one account with its balance
 * PATCH  /:accountId            update
 * POST   /:accountId/archive    archive (idempotent)
 * POST   /:accountId/restore    restore (idempotent)
 */
export function createAccountsRouter(
  dependencies: AccountsModuleDependencies,
  auth: AccountsAuthBoundary,
): Router {
  const service = createAccountsService({
    repository: dependencies.repository,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createAccountsController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, (_req, res, next) => {
    // Financial data is personal: never cache it anywhere.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/', validateRequest(z.object({ query: accountListQuerySchema }), controller.list));
  router.get('/summary', controller.summary);
  router.post(
    '/',
    validateRequest(z.object({ body: createAccountInputSchema }), controller.create),
  );
  router.get('/:accountId', validateRequest(z.object({ params: accountParams }), controller.get));
  router.patch(
    '/:accountId',
    validateRequest(
      z.object({ params: accountParams, body: updateAccountInputSchema }),
      controller.update,
    ),
  );
  router.post(
    '/:accountId/archive',
    validateRequest(z.object({ params: accountParams }), controller.archive),
  );
  router.post(
    '/:accountId/restore',
    validateRequest(z.object({ params: accountParams }), controller.restore),
  );

  return router;
}
