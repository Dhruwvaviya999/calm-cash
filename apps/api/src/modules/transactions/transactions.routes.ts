import {
  bulkTransactionInputSchema,
  createReconciliationInputSchema,
  createTransactionInputSchema,
  entityIdSchema,
  reconciliationPreviewInputSchema,
  transactionFilterQuerySchema,
  transactionListQuerySchema,
  updateTransactionInputSchema,
  voidTransactionInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createTransactionsController } from './transactions.controller';
import type { TransactionsRepository } from './transactions.repository';
import { createTransactionsService } from './transactions.service';

export interface TransactionsModuleDependencies {
  repository: TransactionsRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const transactionParams = z.object({ transactionId: entityIdSchema });

/**
 * Every route requires a session; state-changing routes also require the CSRF token. Requests
 * that record money accept an optional `Idempotency-Key` header (a UUID).
 *
 * GET    /                              list (filters, search, sort, pagination)
 * GET    /summary                       income and spending per currency for the same filters
 * POST   /                              record income, an expense, a transfer, or an adjustment
 * POST   /bulk                          categorise, tag, untag, or void up to 100 at once
 * POST   /reconciliations/preview       compare an observed balance with CalmCash's
 * POST   /reconciliations               record the confirmed balance adjustment
 * GET    /:transactionId                one transaction with its accounts and category
 * PATCH  /:transactionId                edit (partial; `null` clears optional fields)
 * POST   /:transactionId/void           void (idempotent)
 * POST   /:transactionId/restore        undo a void (idempotent)
 */
export function createTransactionsRouter(
  dependencies: TransactionsModuleDependencies,
  auth: AuthBoundary,
): Router {
  const service = createTransactionsService({
    repository: dependencies.repository,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createTransactionsController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get(
    '/',
    validateRequest(z.object({ query: transactionListQuerySchema }), controller.list),
  );
  router.get(
    '/summary',
    validateRequest(z.object({ query: transactionFilterQuerySchema }), controller.summary),
  );
  router.post(
    '/',
    validateRequest(z.object({ body: createTransactionInputSchema }), controller.create),
  );
  router.post(
    '/bulk',
    validateRequest(z.object({ body: bulkTransactionInputSchema }), controller.bulk),
  );
  router.post(
    '/reconciliations/preview',
    validateRequest(
      z.object({ body: reconciliationPreviewInputSchema }),
      controller.previewReconciliation,
    ),
  );
  router.post(
    '/reconciliations',
    validateRequest(z.object({ body: createReconciliationInputSchema }), controller.reconcile),
  );
  router.get(
    '/:transactionId',
    validateRequest(z.object({ params: transactionParams }), controller.get),
  );
  router.patch(
    '/:transactionId',
    validateRequest(
      z.object({ params: transactionParams, body: updateTransactionInputSchema }),
      controller.update,
    ),
  );
  router.post(
    '/:transactionId/void',
    validateRequest(
      // A body is optional: voiding without a reason sends none.
      z.object({ params: transactionParams, body: voidTransactionInputSchema.default({}) }),
      controller.void,
    ),
  );
  router.post(
    '/:transactionId/restore',
    validateRequest(z.object({ params: transactionParams }), controller.restore),
  );

  return router;
}
