import {
  addDaysToIsoDate,
  AMOUNT_FILTER_PATTERN,
  compareAmountFilters,
  currencyCodeSchema,
  DEFAULT_TRANSACTION_PAGE_SIZE,
  entityIdSchema,
  isoDateSchema,
  normalizeTags,
  isValidTag,
  MAX_TAGS_PER_TRANSACTION,
  paymentMethodSchema,
  TEXT_LIMITS,
  transactionSortSchema,
  transactionStatusFilterSchema,
  transactionTypeSchema,
  type CurrencyCode,
  type IsoDateString,
  type PaymentMethod,
  type TransactionSort,
  type TransactionStatusFilter,
  type TransactionType,
} from '@calmcash/shared';
import type { z } from 'zod';

// The transaction list's filters live in the page URL, so a filtered view survives a refresh and
// can be bookmarked. This module converts between URL parameters, the filter state the page works
// with, and the API query. Unknown or malformed parameters are dropped, never sent to the API.
// The URL uses the API's parameter names; it never contains anything but IDs, dates, amounts, and
// the search text the person typed.

export interface TransactionFilters {
  q: string;
  type: TransactionType | undefined;
  accountId: string | undefined;
  categoryId: string | undefined;
  /** Set by links that need one currency (a budget's expenses); not offered in the filter sheet. */
  currency: CurrencyCode | undefined;
  paymentMethod: PaymentMethod | undefined;
  tags: string[];
  from: IsoDateString | undefined;
  to: IsoDateString | undefined;
  minAmount: string | undefined;
  maxAmount: string | undefined;
  status: TransactionStatusFilter;
  sort: TransactionSort;
  page: number;
}

export const DEFAULT_FILTERS: TransactionFilters = {
  q: '',
  type: undefined,
  accountId: undefined,
  categoryId: undefined,
  currency: undefined,
  paymentMethod: undefined,
  tags: [],
  from: undefined,
  to: undefined,
  minAmount: undefined,
  maxAmount: undefined,
  status: 'active',
  sort: 'newest',
  page: 1,
};

export const TRANSACTION_PAGE_SIZE = DEFAULT_TRANSACTION_PAGE_SIZE;

interface ReadableParams {
  get: (name: string) => string | null;
}

function parsed<T>(schema: z.ZodType<T>, value: string | null): T | undefined {
  if (value === null) {
    return undefined;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

function amount(value: string | null): string | undefined {
  return value !== null && AMOUNT_FILTER_PATTERN.test(value) ? value : undefined;
}

/** Filter state from URL parameters; anything malformed falls back to the default. */
export function readFilters(params: ReadableParams): TransactionFilters {
  const page = Number(params.get('page') ?? '1');
  const tags = normalizeTags((params.get('tags') ?? '').split(','))
    .filter(isValidTag)
    .slice(0, MAX_TAGS_PER_TRANSACTION);
  const filters: TransactionFilters = {
    q: (params.get('q') ?? '').trim().slice(0, TEXT_LIMITS.transactionSearch),
    type: parsed(transactionTypeSchema, params.get('type')),
    accountId: parsed(entityIdSchema, params.get('accountId')),
    categoryId: parsed(entityIdSchema, params.get('categoryId')),
    currency: parsed(currencyCodeSchema, params.get('currency')),
    paymentMethod: parsed(paymentMethodSchema, params.get('paymentMethod')),
    tags,
    from: parsed(isoDateSchema, params.get('from')),
    to: parsed(isoDateSchema, params.get('to')),
    minAmount: amount(params.get('minAmount')),
    maxAmount: amount(params.get('maxAmount')),
    status: parsed(transactionStatusFilterSchema, params.get('status')) ?? 'active',
    sort: parsed(transactionSortSchema, params.get('sort')) ?? 'newest',
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
  // Inverted ranges would be refused by the API; keep the start and drop the end.
  if (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) {
    filters.to = undefined;
  }
  if (
    filters.minAmount !== undefined &&
    filters.maxAmount !== undefined &&
    compareAmountFilters(filters.minAmount, filters.maxAmount) > 0
  ) {
    filters.maxAmount = undefined;
  }
  return filters;
}

/** Parameters shared by the URL, the list query, and the summary query (defaults omitted). */
function filterParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (name: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') {
      params.set(name, value);
    }
  };
  set('q', filters.q.trim());
  set('type', filters.type);
  set('accountId', filters.accountId);
  set('categoryId', filters.categoryId);
  set('currency', filters.currency);
  set('paymentMethod', filters.paymentMethod);
  set('tags', filters.tags.join(','));
  set('from', filters.from);
  set('to', filters.to);
  set('minAmount', filters.minAmount);
  set('maxAmount', filters.maxAmount);
  if (filters.status !== 'active') {
    params.set('status', filters.status);
  }
  return params;
}

/** The page URL's query string (without `?`). */
export function filtersToSearch(filters: TransactionFilters): string {
  const params = filterParams(filters);
  if (filters.sort !== 'newest') {
    params.set('sort', filters.sort);
  }
  if (filters.page > 1) {
    params.set('page', filters.page.toString());
  }
  return params.toString();
}

/** Query of `GET /transactions`. */
export function listQuery(filters: TransactionFilters): string {
  const params = filterParams(filters);
  params.set('sort', filters.sort);
  params.set('page', filters.page.toString());
  params.set('pageSize', TRANSACTION_PAGE_SIZE.toString());
  return params.toString();
}

/** Query of `GET /transactions/summary`: exactly the list's filters, without paging or order. */
export function summaryQuery(filters: TransactionFilters): string {
  return filterParams(filters).toString();
}

/** Narrowing filters (search, type, account, …) — not the order, page, or the default status. */
export function countActiveFilters(filters: TransactionFilters): number {
  return [
    filters.q.trim() !== '',
    filters.type !== undefined,
    filters.accountId !== undefined,
    filters.categoryId !== undefined,
    filters.currency !== undefined,
    filters.paymentMethod !== undefined,
    filters.tags.length > 0,
    filters.from !== undefined || filters.to !== undefined,
    filters.minAmount !== undefined || filters.maxAmount !== undefined,
    filters.status !== 'active',
  ].filter(Boolean).length;
}

/** Same filters, first page: every change of filter starts from the top. */
export function withFilters(
  filters: TransactionFilters,
  changes: Partial<TransactionFilters>,
): TransactionFilters {
  return { ...filters, ...changes, page: changes.page ?? 1 };
}

export type PeriodPreset = 'this-month' | 'last-month' | 'last-30-days';

export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30-days', label: 'Last 30 days' },
];

/** Inclusive calendar range of a preset, from "today" in the user's time zone. */
export function periodRange(
  preset: PeriodPreset,
  today: IsoDateString,
): { from: IsoDateString; to: IsoDateString } {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'this-month':
      return { from: monthStart, to: today };
    case 'last-month': {
      const lastDay = addDaysToIsoDate(monthStart, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    case 'last-30-days':
      return { from: addDaysToIsoDate(today, -29), to: today };
  }
}
