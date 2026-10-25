import type {
  AccountDto,
  CategoryDto,
  EntityId,
  IsoDateTimeString,
  MinorUnitsString,
  TransactionDto,
} from '@calmcash/shared';

import type { BudgetProgressProps } from '@/features/budgets';
import type { AccountBalance, CategoryAmount, MonthSummary } from '@/features/dashboard';
import type { TransactionListItem } from '@/features/transactions';

/*
 * ⚠ PROTOTYPE-ONLY SAMPLE DATA — Phase 2 design preview.
 *
 * Every value here is invented. It is typed with the shared API contracts and the features' view
 * models, so the UI is built against real shapes, but it must:
 *   - only be rendered next to a <PreviewNotice> or a "Sample data" label;
 *   - never be imported by components/, hooks/, lib/, services/, or types/ (enforced by ESLint);
 *   - never be sent to the API or persisted.
 * Aggregates (balances, monthly totals) are stated, not calculated: real figures belong to later
 * phases and will come from the API.
 */

const SAMPLE_USER_ID: EntityId = '0193a000-0000-7000-8000-000000000001';
const CREATED_AT: IsoDateTimeString = '2026-09-01T04:30:00.000Z';

function sampleId(sequence: number): EntityId {
  return `0193a000-0000-7000-8000-${sequence.toString().padStart(12, '0')}`;
}

const audit = { userId: SAMPLE_USER_ID, createdAt: CREATED_AT, updatedAt: CREATED_AT } as const;

// --- Categories -------------------------------------------------------------------------------

function category(sequence: number, name: string, kind: CategoryDto['kind']): CategoryDto {
  return { id: sampleId(100 + sequence), name, kind, ...audit };
}

export const sampleCategories = {
  groceries: category(1, 'Groceries', 'expense'),
  dining: category(2, 'Dining out', 'expense'),
  transport: category(3, 'Transport', 'expense'),
  bills: category(4, 'Bills & utilities', 'expense'),
  rent: category(5, 'Rent', 'expense'),
  shopping: category(6, 'Shopping', 'expense'),
  health: category(7, 'Health', 'expense'),
  entertainment: category(8, 'Entertainment', 'expense'),
  salary: category(9, 'Salary', 'income'),
  freelance: category(10, 'Freelance', 'income'),
  interest: category(11, 'Interest', 'income'),
} as const satisfies Record<string, CategoryDto>;

// --- Accounts ---------------------------------------------------------------------------------

function account(
  sequence: number,
  name: string,
  type: AccountDto['type'],
  openingBalanceMinor: MinorUnitsString,
): AccountDto {
  return {
    id: sampleId(200 + sequence),
    name,
    type,
    currency: 'INR',
    openingBalanceMinor,
    ...audit,
  };
}

export const sampleAccounts = {
  savings: account(1, 'Everyday Savings', 'bank', '18500000'),
  card: account(2, 'Rewards Credit Card', 'credit_card', '-1250000'),
  wallet: account(3, 'UPI Wallet', 'digital_wallet', '150000'),
  cash: account(4, 'Cash', 'cash', '320000'),
} as const satisfies Record<string, AccountDto>;

/** Stated sample balances (real balances will be calculated by the API). */
export const sampleAccountBalances: readonly AccountBalance[] = [
  { account: sampleAccounts.savings, balanceMinor: '21650000' },
  { account: sampleAccounts.card, balanceMinor: '-1834900' },
  { account: sampleAccounts.wallet, balanceMinor: '352500' },
  { account: sampleAccounts.cash, balanceMinor: '240000' },
];

// --- Transactions -----------------------------------------------------------------------------

interface SampleTransactionInput {
  sequence: number;
  accountId: EntityId;
  amountMinor: MinorUnitsString;
  description: string;
  occurredAt: IsoDateTimeString;
}

type CategorisedInput = SampleTransactionInput & {
  merchant: string;
  categoryId: EntityId;
  notes?: string;
};

function income({ sequence, ...rest }: CategorisedInput): TransactionDto {
  return { id: sampleId(300 + sequence), type: 'income', currency: 'INR', ...rest, ...audit };
}

function expense({ sequence, ...rest }: CategorisedInput): TransactionDto {
  return { id: sampleId(300 + sequence), type: 'expense', currency: 'INR', ...rest, ...audit };
}

function transfer({
  sequence,
  ...rest
}: SampleTransactionInput & { transferAccountId: EntityId }): TransactionDto {
  return { id: sampleId(300 + sequence), type: 'transfer', currency: 'INR', ...rest, ...audit };
}

const c = sampleCategories;
const a = sampleAccounts;

/** Newest first. */
export const sampleTransactions: readonly TransactionDto[] = [
  expense({
    sequence: 1,
    accountId: a.card.id,
    categoryId: c.entertainment.id,
    merchant: 'CineMax',
    description: 'Movie night with friends',
    amountMinor: '64000',
    occurredAt: '2026-10-25T14:10:00.000Z',
  }),
  expense({
    sequence: 2,
    accountId: a.card.id,
    categoryId: c.dining.id,
    merchant: 'Brew & Bean Café',
    description: 'Coffee and sandwiches',
    amountMinor: '48000',
    occurredAt: '2026-10-24T06:20:00.000Z',
  }),
  expense({
    sequence: 3,
    accountId: a.wallet.id,
    categoryId: c.groceries.id,
    merchant: 'FreshMart',
    description: 'Weekly groceries',
    notes: 'Includes festival sweets',
    amountMinor: '245000',
    occurredAt: '2026-10-23T12:45:00.000Z',
  }),
  expense({
    sequence: 4,
    accountId: a.card.id,
    categoryId: c.transport.id,
    merchant: 'Metro Fuel',
    description: 'Petrol refill',
    amountMinor: '320000',
    occurredAt: '2026-10-22T03:30:00.000Z',
  }),
  income({
    sequence: 5,
    accountId: a.savings.id,
    categoryId: c.freelance.id,
    merchant: 'Northwind Studio',
    description: 'Logo design project',
    amountMinor: '1800000',
    occurredAt: '2026-10-20T09:00:00.000Z',
  }),
  expense({
    sequence: 6,
    accountId: a.card.id,
    categoryId: c.shopping.id,
    merchant: 'Urban Threads',
    description: 'Diwali outfit',
    amountMinor: '459900',
    occurredAt: '2026-10-19T11:15:00.000Z',
  }),
  transfer({
    sequence: 7,
    accountId: a.savings.id,
    transferAccountId: a.card.id,
    description: 'Credit card bill payment',
    amountMinor: '1250000',
    occurredAt: '2026-10-18T05:00:00.000Z',
  }),
  expense({
    sequence: 8,
    accountId: a.wallet.id,
    categoryId: c.health.id,
    merchant: 'WellCare Pharmacy',
    description: 'Monthly medicines',
    amountMinor: '72500',
    occurredAt: '2026-10-16T13:05:00.000Z',
  }),
  transfer({
    sequence: 9,
    accountId: a.savings.id,
    transferAccountId: a.wallet.id,
    description: 'Wallet top-up',
    amountMinor: '500000',
    occurredAt: '2026-10-15T08:40:00.000Z',
  }),
  expense({
    sequence: 10,
    accountId: a.savings.id,
    categoryId: c.bills.id,
    merchant: 'City Power',
    description: 'Electricity bill for September',
    amountMinor: '186000',
    occurredAt: '2026-10-12T04:30:00.000Z',
  }),
  expense({
    sequence: 11,
    accountId: a.savings.id,
    categoryId: c.rent.id,
    merchant: 'Greenview Apartments',
    description: 'Monthly rent',
    amountMinor: '2800000',
    occurredAt: '2026-10-02T04:00:00.000Z',
  }),
  income({
    sequence: 12,
    accountId: a.savings.id,
    categoryId: c.salary.id,
    merchant: 'Acme Technologies',
    description: 'October salary',
    amountMinor: '9500000',
    occurredAt: '2026-10-01T05:30:00.000Z',
  }),
  income({
    sequence: 13,
    accountId: a.savings.id,
    categoryId: c.interest.id,
    merchant: 'Everyday Savings',
    description: 'Quarterly interest',
    amountMinor: '112000',
    occurredAt: '2026-10-01T02:00:00.000Z',
  }),
];

const accountsById = new Map<EntityId, AccountDto>(
  Object.values(sampleAccounts).map((entry) => [entry.id, entry]),
);
const categoriesById = new Map<EntityId, CategoryDto>(
  Object.values(sampleCategories).map((entry) => [entry.id, entry]),
);

function requireAccount(id: EntityId): AccountDto {
  const found = accountsById.get(id);
  if (found === undefined) {
    throw new Error(`Sample account ${id} is missing.`);
  }
  return found;
}

/** Sample transactions joined with their accounts and categories, ready for list rows. */
export const sampleTransactionItems: readonly TransactionListItem[] = sampleTransactions.map(
  (transaction) => ({
    transaction,
    account: requireAccount(transaction.accountId),
    category:
      transaction.type === 'transfer'
        ? undefined
        : categoriesById.get(transaction.categoryId ?? ''),
    transferAccount:
      transaction.type === 'transfer' ? requireAccount(transaction.transferAccountId) : undefined,
  }),
);

// --- Budgets ----------------------------------------------------------------------------------

function budget(
  sequence: number,
  budgetCategory: CategoryDto,
  limitMinor: MinorUnitsString,
  spentMinor: MinorUnitsString,
): BudgetProgressProps {
  return {
    budget: {
      id: sampleId(400 + sequence),
      name: budgetCategory.name,
      categoryId: budgetCategory.id,
      limitMinor,
      currency: 'INR',
      period: 'monthly',
      startDate: '2026-10-01',
      ...audit,
    },
    category: budgetCategory,
    spentMinor,
  };
}

/** Stated sample spending per budget (real figures will be calculated by the API). */
export const sampleBudgets: readonly BudgetProgressProps[] = [
  budget(1, c.groceries, '1200000', '845000'),
  budget(2, c.dining, '500000', '462000'),
  budget(3, c.shopping, '600000', '689900'),
  budget(4, c.transport, '800000', '410000'),
];

// --- Monthly overview -------------------------------------------------------------------------

/** Largest first; stated sample totals for the preview period. */
export const sampleSpendingByCategory: readonly CategoryAmount[] = [
  { category: c.rent, amountMinor: '2800000' },
  { category: c.groceries, amountMinor: '845000' },
  { category: c.shopping, amountMinor: '689900' },
  { category: c.dining, amountMinor: '462000' },
  { category: c.transport, amountMinor: '410000' },
  { category: c.bills, amountMinor: '186000' },
  { category: c.health, amountMinor: '72500' },
  { category: c.entertainment, amountMinor: '64000' },
];

export const sampleMonthSummary: MonthSummary = {
  periodLabel: 'October 2026',
  totalBalanceMinor: '20407600',
  incomeMinor: '11412000',
  spendingMinor: '5529400',
  savedMinor: '5882600',
  savedTrend: [
    { month: 'May', amountMinor: '3120000' },
    { month: 'Jun', amountMinor: '4210000' },
    { month: 'Jul', amountMinor: '2850000' },
    { month: 'Aug', amountMinor: '4980000' },
    { month: 'Sep', amountMinor: '3760000' },
    { month: 'Oct', amountMinor: '5882600' },
  ],
};
