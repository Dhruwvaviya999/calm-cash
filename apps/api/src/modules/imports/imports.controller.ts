import type {
  ClassifyImportRowsInput,
  ImportAdjustmentInput,
  ImportBatchDetailDto,
  ImportBatchDto,
  ImportBatchListDto,
  ImportReconciliationDto,
  ImportRowDecisionInput,
  ImportRowDto,
  ImportRowListQuery,
  ImportRowPageDto,
  ImportRowsInput,
  ImportRowsResultDto,
  ImportSettingsInput,
  ImportUploadQuery,
  UpdateImportRowInput,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { ImportsService } from './imports.service';

interface BatchParams {
  params: { batchId: string };
}

interface RowParams {
  params: { batchId: string; rowId: string };
}

export interface ImportsController {
  list: Handler<object, ImportBatchListDto>;
  upload: Handler<{ query: ImportUploadQuery; body: Buffer }, ImportBatchDetailDto>;
  get: Handler<BatchParams, ImportBatchDetailDto>;
  saveSettings: Handler<BatchParams & { body: ImportSettingsInput }, ImportBatchDetailDto>;
  recheck: Handler<BatchParams, ImportBatchDetailDto>;
  rows: Handler<BatchParams & { query: ImportRowListQuery }, ImportRowPageDto>;
  row: Handler<RowParams, ImportRowDto>;
  updateRow: Handler<RowParams & { body: UpdateImportRowInput }, ImportRowDto>;
  decide: Handler<RowParams & { body: ImportRowDecisionInput }, ImportRowDto>;
  classify: Handler<BatchParams & { body: ClassifyImportRowsInput }, ImportBatchDto>;
  importRows: Handler<BatchParams & { body: ImportRowsInput }, ImportRowsResultDto>;
  reconciliation: Handler<BatchParams, ImportReconciliationDto>;
  adjust: Handler<BatchParams & { body: ImportAdjustmentInput }, ImportReconciliationDto>;
  complete: Handler<BatchParams, ImportBatchDto>;
  cancel: Handler<BatchParams, ImportBatchDto>;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createImportsController(
  service: ImportsService,
  getCaller: (req: object) => Caller,
): ImportsController {
  return {
    list: async (_input, req, res) => {
      sendSuccess(res, await service.list(getCaller(req)));
    },
    upload: async ({ query, body }, req, res) => {
      sendSuccess(res, await service.upload(getCaller(req), query, body), 201);
    },
    get: async ({ params }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.batchId));
    },
    saveSettings: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.saveSettings(getCaller(req), params.batchId, body));
    },
    recheck: async ({ params }, req, res) => {
      sendSuccess(res, await service.recheck(getCaller(req), params.batchId));
    },
    rows: async ({ params, query }, req, res) => {
      sendSuccess(res, await service.rows(getCaller(req), params.batchId, query));
    },
    row: async ({ params }, req, res) => {
      sendSuccess(res, await service.row(getCaller(req), params.batchId, params.rowId));
    },
    updateRow: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.updateRow(getCaller(req), params.batchId, params.rowId, body));
    },
    decide: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.decide(getCaller(req), params.batchId, params.rowId, body));
    },
    classify: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.classify(getCaller(req), params.batchId, body));
    },
    importRows: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.importRows(getCaller(req), params.batchId, body));
    },
    reconciliation: async ({ params }, req, res) => {
      sendSuccess(res, await service.reconciliation(getCaller(req), params.batchId));
    },
    adjust: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.adjust(getCaller(req), params.batchId, body), 201);
    },
    complete: async ({ params }, req, res) => {
      sendSuccess(res, await service.complete(getCaller(req), params.batchId));
    },
    cancel: async ({ params }, req, res) => {
      sendSuccess(res, await service.cancel(getCaller(req), params.batchId));
    },
  };
}
