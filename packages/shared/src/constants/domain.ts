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
 * `accountId` to `transferAccountId` and is excluded from income/expense reporting.
 */
export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

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
} as const;
