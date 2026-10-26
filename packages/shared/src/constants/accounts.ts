import type { AccountType } from './domain';

// Account domain rules shared by the API (enforcement) and the web app (forms and presentation).

/** Account types a person can choose when adding an account. */
export const CREATABLE_ACCOUNT_TYPES = [
  'cash',
  'bank',
  'savings',
  'digital_wallet',
  'credit_card',
  'other',
] as const satisfies readonly AccountType[];

export type CreatableAccountType = (typeof CREATABLE_ACCOUNT_TYPES)[number];

/**
 * `asset`: the balance is money held. `liability`: the balance is money owed, and it must never be
 * added to assets or presented as money owned.
 */
export const ACCOUNT_CLASSIFICATIONS = ['asset', 'liability'] as const;

export type AccountClassification = (typeof ACCOUNT_CLASSIFICATIONS)[number];

export const ACCOUNT_TYPE_CLASSIFICATION = {
  cash: 'asset',
  bank: 'asset',
  savings: 'asset',
  digital_wallet: 'asset',
  investment: 'asset',
  other: 'asset',
  credit_card: 'liability',
  loan: 'liability',
} as const satisfies Readonly<Record<AccountType, AccountClassification>>;

export function getAccountClassification(type: AccountType): AccountClassification {
  return ACCOUNT_TYPE_CLASSIFICATION[type];
}

/** Types whose balance can never be below zero (you cannot hold negative cash). */
export const NON_NEGATIVE_BALANCE_ACCOUNT_TYPES = [
  'cash',
  'savings',
  'digital_wallet',
] as const satisfies readonly AccountType[];

export function requiresNonNegativeBalance(type: AccountType): boolean {
  return NON_NEGATIVE_BALANCE_ACCOUNT_TYPES.some((candidate) => candidate === type);
}

/** Only credit cards have a credit limit. */
export function supportsCreditLimit(type: AccountType): boolean {
  return type === 'credit_card';
}

/** `archived` accounts keep their history but are hidden and closed to new activity. */
export const ACCOUNT_STATUSES = ['active', 'archived'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Values of the `status` filter of `GET /accounts`. */
export const ACCOUNT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;

export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];

/** Optional accent colours for an account; mapped to design tokens by the web app. */
export const ACCOUNT_COLORS = ['green', 'blue', 'amber', 'purple', 'coral', 'slate'] as const;

export type AccountColor = (typeof ACCOUNT_COLORS)[number];

/** Earliest accepted opening-balance date. */
export const EARLIEST_OPENING_BALANCE_DATE = '1900-01-01';
