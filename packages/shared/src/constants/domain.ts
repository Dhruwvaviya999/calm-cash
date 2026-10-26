// Literal values shared by the database enums (prisma/schema.prisma), the API, and the web app.
// The API test suite asserts that the generated Prisma enums stay identical to these lists.

/**
 * Every account type the database can hold. `investment` and `loan` date from Phase 1 and are kept
 * for compatibility, but new accounts can only use `CREATABLE_ACCOUNT_TYPES` (constants/accounts).
 */
export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'savings',
  'credit_card',
  'digital_wallet',
  'investment',
  'loan',
  'other',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * `income` and `expense` change a single account's balance; `transfer` moves money from
 * `accountId` to `transferAccountId`; `balance_adjustment` corrects one account's balance by an
 * explicit amount and direction (reconciliation). Transfers and adjustments are never income or
 * spending.
 */
export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'balance_adjustment'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * Which way a balance adjustment moves the account's signed net position. For a credit card,
 * `decrease` means the amount owed goes up.
 */
export const ADJUSTMENT_DIRECTIONS = ['increase', 'decrease'] as const;

export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

/** How a payment was made. Optional on income, expenses, and transfers. */
export const PAYMENT_METHODS = [
  'cash',
  'upi',
  'bank_transfer',
  'debit_card',
  'credit_card',
  'net_banking',
  'cheque',
  'digital_wallet',
  'direct_debit',
  'other',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CATEGORY_KINDS = ['income', 'expense'] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const BUDGET_PERIODS = ['weekly', 'monthly', 'quarterly', 'yearly', 'custom'] as const;

export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

/** Maximum text lengths; they mirror the `VARCHAR` sizes in prisma/schema.prisma. */
export const TEXT_LIMITS = {
  userName: 100,
  email: 254,
  timezone: 64,
  accountName: 100,
  accountInstitution: 100,
  categoryName: 50,
  budgetName: 100,
  transactionDescription: 255,
  transactionMerchant: 120,
  transactionNotes: 2000,
  transactionVoidReason: 500,
  transactionTag: 32,
  transactionSearch: 100,
} as const;
