import {
  importBatchDetailDtoSchema,
  importBatchDtoSchema,
  importBatchListDtoSchema,
  importReconciliationDtoSchema,
  importRowDtoSchema,
  importRowPageDtoSchema,
  importRowsResultDtoSchema,
  type CsvDelimiter,
  type EntityId,
  type ImportAdjustmentInput,
  type ImportBatchDetailDto,
  type ImportBatchDto,
  type ImportBatchListDto,
  type ImportReconciliationDto,
  type ImportRowDecisionInput,
  type ImportRowDto,
  type ImportRowPageDto,
  type ImportRowsResultDto,
  type ImportSettingsInput,
  type UpdateImportRowInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per statement-import endpoint; every response is validated against the shared
// schema. The statement file is sent once as the raw body of the upload and is never stored.

function batchPath(batchId: EntityId): `/${string}` {
  return `/imports/${encodeURIComponent(batchId)}`;
}

function rowPath(batchId: EntityId, rowId: EntityId): `/${string}` {
  return `${batchPath(batchId)}/rows/${encodeURIComponent(rowId)}`;
}

export function listImports(signal?: AbortSignal): Promise<ImportBatchListDto> {
  return api.request('/imports', { schema: importBatchListDtoSchema, signal });
}

export interface UploadOptions {
  accountId: EntityId;
  file: File;
  delimiter?: CsvDelimiter | undefined;
  hasHeaderRow?: boolean | undefined;
}

export function uploadStatement({
  accountId,
  file,
  delimiter,
  hasHeaderRow,
}: UploadOptions): Promise<ImportBatchDetailDto> {
  const query = new URLSearchParams({ accountId, fileName: file.name });
  if (delimiter !== undefined) query.set('delimiter', delimiter);
  if (hasHeaderRow !== undefined) query.set('hasHeaderRow', String(hasHeaderRow));
  return api.request(`/imports?${query.toString()}`, {
    schema: importBatchDetailDtoSchema,
    method: 'POST',
    // Sent as CSV text whatever the browser guessed from the extension; the API checks the content.
    file: new Blob([file], { type: 'text/csv' }),
  });
}

export function getImport(batchId: EntityId, signal?: AbortSignal): Promise<ImportBatchDetailDto> {
  return api.request(batchPath(batchId), { schema: importBatchDetailDtoSchema, signal });
}

export function saveImportSettings(
  batchId: EntityId,
  input: ImportSettingsInput,
): Promise<ImportBatchDetailDto> {
  return api.request(`${batchPath(batchId)}/settings`, {
    schema: importBatchDetailDtoSchema,
    method: 'PUT',
    body: input,
  });
}

export function recheckImport(batchId: EntityId): Promise<ImportBatchDetailDto> {
  return api.request(`${batchPath(batchId)}/recheck`, {
    schema: importBatchDetailDtoSchema,
    method: 'POST',
  });
}

/** `query` is a URL query string without the leading `?` (`status=…&page=…`). */
export function listImportRows(
  batchId: EntityId,
  query: string,
  signal?: AbortSignal,
): Promise<ImportRowPageDto> {
  return api.request(`${batchPath(batchId)}/rows${query === '' ? '' : `?${query}`}`, {
    schema: importRowPageDtoSchema,
    signal,
  });
}

export function updateImportRow(
  batchId: EntityId,
  rowId: EntityId,
  input: UpdateImportRowInput,
): Promise<ImportRowDto> {
  return api.request(rowPath(batchId, rowId), {
    schema: importRowDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export function decideImportRow(
  batchId: EntityId,
  rowId: EntityId,
  input: ImportRowDecisionInput,
): Promise<ImportRowDto> {
  return api.request(`${rowPath(batchId, rowId)}/decision`, {
    schema: importRowDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function classifyImportRows(
  batchId: EntityId,
  rowIds: EntityId[],
  categoryId: EntityId,
): Promise<ImportBatchDto> {
  return api.request(`${batchPath(batchId)}/rows/classify`, {
    schema: importBatchDtoSchema,
    method: 'POST',
    body: { rowIds, categoryId },
  });
}

/** Records the rows; repeating the request never records a row twice. */
export function importRows(batchId: EntityId, rowIds: EntityId[]): Promise<ImportRowsResultDto> {
  return api.request(`${batchPath(batchId)}/import`, {
    schema: importRowsResultDtoSchema,
    method: 'POST',
    body: { rowIds },
  });
}

export function getImportReconciliation(
  batchId: EntityId,
  signal?: AbortSignal,
): Promise<ImportReconciliationDto> {
  return api.request(`${batchPath(batchId)}/reconciliation`, {
    schema: importReconciliationDtoSchema,
    signal,
  });
}

export function recordImportAdjustment(
  batchId: EntityId,
  input: ImportAdjustmentInput,
): Promise<ImportReconciliationDto> {
  return api.request(`${batchPath(batchId)}/reconciliation/adjustment`, {
    schema: importReconciliationDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function finishImport(
  batchId: EntityId,
  action: 'complete' | 'cancel',
): Promise<ImportBatchDto> {
  return api.request(`${batchPath(batchId)}/${action}`, {
    schema: importBatchDtoSchema,
    method: 'POST',
  });
}
