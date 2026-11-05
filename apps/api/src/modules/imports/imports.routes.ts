import {
  classifyImportRowsInputSchema,
  entityIdSchema,
  importAdjustmentInputSchema,
  importRowDecisionInputSchema,
  importRowListQuerySchema,
  importRowsInputSchema,
  importSettingsInputSchema,
  importUploadQuerySchema,
  MAX_STATEMENT_FILE_BYTES,
  updateImportRowInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import type { RateLimitStoreFactory } from '../../lib/rate-limit';
import {
  DEFAULT_UPLOAD_RATE,
  rawBody,
  uploadBodySchema,
  uploadRateLimit,
  type UploadRateRule,
} from '../../lib/upload';
import { validateRequest } from '../../middleware/validate-request';
import type { TransactionsService } from '../transactions';
import { createImportsController } from './imports.controller';
import type { ImportsRepository } from './imports.repository';
import { createImportsService } from './imports.service';

export interface ImportsModuleDependencies {
  repository: ImportsRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  uploadRate?: UploadRateRule;
  /** Shared counter store for the rate limits (in memory when omitted). */
  rateLimitStore?: RateLimitStoreFactory;
}

const batchParams = z.object({ batchId: entityIdSchema });
const rowParams = z.object({ batchId: entityIdSchema, rowId: entityIdSchema });

/**
 * Statement imports. Every route requires a session; state-changing routes also require the CSRF
 * token. The statement file is the raw body of the upload (≤ 2 MB); it is read once into bounded
 * staged rows and never stored. Only `…/import` and `…/reconciliation/adjustment` record money,
 * and only through the transactions module.
 *
 * GET    /                                    import history (newest first)
 * POST   /?accountId=&fileName=[&delimiter=&hasHeaderRow=]   upload a CSV statement
 * GET    /:batchId                            the import, with sample rows and a proposed mapping
 * PUT    /:batchId/settings                   confirm columns, date format, sign convention, statement info
 * POST   /:batchId/recheck                    look for duplicates again with the current ledger
 * GET    /:batchId/rows                       staged rows (`status`, `page`)
 * GET    /:batchId/rows/:rowId                one row
 * PATCH  /:batchId/rows/:rowId                edit what will be recorded
 * POST   /:batchId/rows/:rowId/decision       match, not a duplicate, skip, restore
 * POST   /:batchId/rows/classify              set one category on several rows
 * POST   /:batchId/import                     record selected rows (≤ 200 per request; idempotent)
 * GET    /:batchId/reconciliation             statement balances against the ledger
 * POST   /:batchId/reconciliation/adjustment  record the approved correction (existing reconciliation)
 * POST   /:batchId/complete                   finish (raw cells are discarded)
 * POST   /:batchId/cancel                     abandon (imported transactions stay)
 */
export function createImportsRouter(
  dependencies: ImportsModuleDependencies,
  transactions: Pick<TransactionsService, 'recordLinked' | 'reconcile'>,
  auth: AuthBoundary,
): Router {
  const service = createImportsService({
    repository: dependencies.repository,
    transactions,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createImportsController(service, auth.getCaller);
  const router = Router();
  const params = z.object({ params: batchParams });
  const row = z.object({ params: rowParams });

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get('/', validateRequest(z.object({}), controller.list));
  router.post(
    '/',
    uploadRateLimit(
      'imports.upload',
      dependencies.uploadRate ?? DEFAULT_UPLOAD_RATE,
      (req) => auth.getCaller(req).userId,
      dependencies.rateLimitStore,
    ),
    rawBody(MAX_STATEMENT_FILE_BYTES),
    validateRequest(
      z.object({ query: importUploadQuerySchema, body: uploadBodySchema }),
      controller.upload,
    ),
  );
  router.get('/:batchId', validateRequest(params, controller.get));
  router.put(
    '/:batchId/settings',
    validateRequest(
      z.object({ params: batchParams, body: importSettingsInputSchema }),
      controller.saveSettings,
    ),
  );
  router.post('/:batchId/recheck', validateRequest(params, controller.recheck));
  router.get(
    '/:batchId/rows',
    validateRequest(
      z.object({ params: batchParams, query: importRowListQuerySchema }),
      controller.rows,
    ),
  );
  router.post(
    '/:batchId/rows/classify',
    validateRequest(
      z.object({ params: batchParams, body: classifyImportRowsInputSchema }),
      controller.classify,
    ),
  );
  router.get('/:batchId/rows/:rowId', validateRequest(row, controller.row));
  router.patch(
    '/:batchId/rows/:rowId',
    validateRequest(
      z.object({ params: rowParams, body: updateImportRowInputSchema }),
      controller.updateRow,
    ),
  );
  router.post(
    '/:batchId/rows/:rowId/decision',
    validateRequest(
      z.object({ params: rowParams, body: importRowDecisionInputSchema }),
      controller.decide,
    ),
  );
  router.post(
    '/:batchId/import',
    validateRequest(
      z.object({ params: batchParams, body: importRowsInputSchema }),
      controller.importRows,
    ),
  );
  router.get('/:batchId/reconciliation', validateRequest(params, controller.reconciliation));
  router.post(
    '/:batchId/reconciliation/adjustment',
    validateRequest(
      z.object({ params: batchParams, body: importAdjustmentInputSchema }),
      controller.adjust,
    ),
  );
  router.post('/:batchId/complete', validateRequest(params, controller.complete));
  router.post('/:batchId/cancel', validateRequest(params, controller.cancel));

  return router;
}
