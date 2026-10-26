import {
  accountDtoSchema,
  budgetDtoSchema,
  categoryDtoSchema,
  parseMinorUnits,
  transactionDtoSchema,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  sampleAccountBalances,
  sampleAccounts,
  sampleBudgets,
  sampleCategories,
  sampleMonthSummary,
  sampleSpendingByCategory,
  sampleTransactionItems,
  sampleTransactions,
} from './sample-finances';

const sum = (amounts: readonly string[]): bigint =>
  amounts.reduce((total, amount) => total + parseMinorUnits(amount), 0n);

describe('sample fixtures', () => {
  it('conform to the shared API contracts', () => {
    for (const entry of Object.values(sampleCategories)) categoryDtoSchema.parse(entry);
    for (const entry of Object.values(sampleAccounts)) accountDtoSchema.parse(entry);
    for (const entry of sampleTransactions) transactionDtoSchema.parse(entry);
    for (const entry of sampleBudgets) budgetDtoSchema.parse(entry.budget);
  });

  it('are listed newest first and fully resolved for list rows', () => {
    const times = sampleTransactions.map((entry) => Date.parse(entry.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const item of sampleTransactionItems) {
      expect(item.account.id).toBe(item.transaction.accountId);
      if (item.transaction.type === 'transfer') {
        expect(item.transferAccount?.id).toBe(item.transaction.transferAccountId);
      } else if (item.transaction.type !== 'balance_adjustment') {
        expect(item.category?.id).toBe(item.transaction.categoryId);
      }
    }
  });

  it('state internally consistent totals', () => {
    const summary = sampleMonthSummary;
    expect(sum(sampleAccountBalances.map((entry) => entry.balanceMinor))).toBe(
      parseMinorUnits(summary.totalBalanceMinor),
    );
    expect(sum(sampleSpendingByCategory.map((entry) => entry.amountMinor))).toBe(
      parseMinorUnits(summary.spendingMinor),
    );
    expect(parseMinorUnits(summary.incomeMinor) - parseMinorUnits(summary.spendingMinor)).toBe(
      parseMinorUnits(summary.savedMinor),
    );
    expect(summary.savedTrend.at(-1)?.amountMinor).toBe(summary.savedMinor);
  });
});
