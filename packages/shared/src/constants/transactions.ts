import type { CategoryKind, TransactionType } from './domain';

// Transaction rules shared by the API (enforcement) and the web app (forms, filters, labels).

/** `voided` transactions are kept for the record but count toward nothing. */
export const TRANSACTION_STATUSES = ['active', 'voided'] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Values of the `status` filter of `GET /transactions`. */
export const TRANSACTION_STATUS_FILTERS = ['active', 'voided', 'all'] as const;

export type TransactionStatusFilter = (typeof TRANSACTION_STATUS_FILTERS)[number];

/**
 * The only orders `GET /transactions` accepts. Each one ends with the transaction ID as a
 * tie-breaker, so pages never overlap or skip rows.
 */
export const TRANSACTION_SORTS = ['newest', 'oldest', 'largest', 'smallest'] as const;

export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

export const DEFAULT_TRANSACTION_PAGE_SIZE = 25;
export const MAX_TRANSACTION_PAGE_SIZE = 100;

export const MAX_TAGS_PER_TRANSACTION = 10;

/** Upper bound of one bulk request (`POST /transactions/bulk`). */
export const MAX_BULK_TRANSACTIONS = 100;

/** Earliest accepted transaction date (calendar date in the user's time zone). */
export const EARLIEST_TRANSACTION_DATE = '1900-01-01';

/** Description stored for a transfer recorded without one. */
export const DEFAULT_TRANSFER_DESCRIPTION = 'Transfer between accounts';

/** Transaction types that represent money earned or spent and appear in cash-flow totals. */
export const CASH_FLOW_TRANSACTION_TYPES = [
  'income',
  'expense',
] as const satisfies readonly TransactionType[];

export type CashFlowTransactionType = (typeof CASH_FLOW_TRANSACTION_TYPES)[number];

export function isCashFlowTransactionType(type: TransactionType): type is CashFlowTransactionType {
  return type === 'income' || type === 'expense';
}

/** The category kind a transaction type may use; transfers and adjustments are never categorised. */
export function categoryKindForTransactionType(type: TransactionType): CategoryKind | undefined {
  switch (type) {
    case 'income':
      return 'income';
    case 'expense':
      return 'expense';
    case 'transfer':
    case 'balance_adjustment':
      return undefined;
  }
}

/** Fields that only some transaction types may carry. */
export const TYPE_SPECIFIC_TRANSACTION_FIELDS = [
  'transferAccountId',
  'merchant',
  'categoryId',
  'paymentMethod',
  'adjustmentDirection',
] as const;

export type TypeSpecificTransactionField = (typeof TYPE_SPECIFIC_TRANSACTION_FIELDS)[number];

/** Which type-specific fields each type accepts; any other one is rejected, never ignored. */
export const TRANSACTION_TYPE_FIELDS = {
  income: ['merchant', 'categoryId', 'paymentMethod'],
  expense: ['merchant', 'categoryId', 'paymentMethod'],
  transfer: ['transferAccountId', 'paymentMethod'],
  balance_adjustment: ['adjustmentDirection'],
} as const satisfies Readonly<Record<TransactionType, readonly TypeSpecificTransactionField[]>>;

export function transactionTypeAccepts(
  type: TransactionType,
  field: TypeSpecificTransactionField,
): boolean {
  const accepted: readonly TypeSpecificTransactionField[] = TRANSACTION_TYPE_FIELDS[type];
  return accepted.includes(field);
}

/** Bulk actions of `POST /transactions/bulk`. */
export const BULK_TRANSACTION_ACTIONS = [
  'set_category',
  'add_tags',
  'remove_tags',
  'void',
] as const;

export type BulkTransactionAction = (typeof BULK_TRANSACTION_ACTIONS)[number];

/** `archived` categories stay on past transactions but cannot be chosen for new ones. */
export const CATEGORY_STATUSES = ['active', 'archived'] as const;

export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];
