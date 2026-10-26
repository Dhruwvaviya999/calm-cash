import {
  bulkTransactionResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  reconciliationPreviewDtoSchema,
  tagListDtoSchema,
  transactionListItemDtoSchema,
  transactionPageDtoSchema,
  transactionSummaryDtoSchema,
  type BulkTransactionInput,
  type BulkTransactionResultDto,
  type CreateReconciliationInput,
  type CreateTransactionInput,
  type EntityId,
  type ReconciliationPreviewDto,
  type ReconciliationPreviewInput,
  type TagListDto,
  type TransactionListItemDto,
  type TransactionPageDto,
  type TransactionSummaryDto,
  type UpdateTransactionInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per transactions endpoint; every response is validated against the shared schema.
// Requests that record money carry an idempotency key, so a retry after a lost response can never
// record the same money twice.

function transactionPath(transactionId: EntityId): `/${string}` {
  return `/transactions/${encodeURIComponent(transactionId)}`;
}

/** `query` is the URL query string built from validated filters, without the leading `?`. */
export function listTransactions(query: string, signal?: AbortSignal): Promise<TransactionPageDto> {
  return api.request(`/transactions${query === '' ? '' : `?${query}`}`, {
    schema: transactionPageDtoSchema,
    signal,
  });
}

export function getTransactionSummary(
  query: string,
  signal?: AbortSignal,
): Promise<TransactionSummaryDto> {
  return api.request(`/transactions/summary${query === '' ? '' : `?${query}`}`, {
    schema: transactionSummaryDtoSchema,
    signal,
  });
}

export function getTransaction(
  transactionId: EntityId,
  signal?: AbortSignal,
): Promise<TransactionListItemDto> {
  return api.request(transactionPath(transactionId), {
    schema: transactionListItemDtoSchema,
    signal,
  });
}

export function createTransaction(
  input: CreateTransactionInput,
  idempotencyKey: string,
): Promise<TransactionListItemDto> {
  return api.request('/transactions', {
    schema: transactionListItemDtoSchema,
    method: 'POST',
    body: input,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

export function updateTransaction(
  transactionId: EntityId,
  input: UpdateTransactionInput,
): Promise<TransactionListItemDto> {
  return api.request(transactionPath(transactionId), {
    schema: transactionListItemDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export function voidTransaction(
  transactionId: EntityId,
  reason?: string,
): Promise<TransactionListItemDto> {
  return api.request(`${transactionPath(transactionId)}/void`, {
    schema: transactionListItemDtoSchema,
    method: 'POST',
    body: reason === undefined ? {} : { reason },
  });
}

export function restoreTransaction(transactionId: EntityId): Promise<TransactionListItemDto> {
  return api.request(`${transactionPath(transactionId)}/restore`, {
    schema: transactionListItemDtoSchema,
    method: 'POST',
  });
}

export function bulkUpdateTransactions(
  input: BulkTransactionInput,
): Promise<BulkTransactionResultDto> {
  return api.request('/transactions/bulk', {
    schema: bulkTransactionResultDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function previewReconciliation(
  input: ReconciliationPreviewInput,
): Promise<ReconciliationPreviewDto> {
  return api.request('/transactions/reconciliations/preview', {
    schema: reconciliationPreviewDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function reconcileBalance(
  input: CreateReconciliationInput,
  idempotencyKey: string,
): Promise<TransactionListItemDto> {
  return api.request('/transactions/reconciliations', {
    schema: transactionListItemDtoSchema,
    method: 'POST',
    body: input,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

export function listTags(signal?: AbortSignal): Promise<TagListDto> {
  return api.request('/tags', { schema: tagListDtoSchema, signal });
}
