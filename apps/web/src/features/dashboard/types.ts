import type { AccountDto, CategoryDto, MinorUnitsString } from '@calmcash/shared';

// View models for dashboard sections. They wrap shared contracts with figures that the API will
// eventually provide (balances, totals); the dashboard never calculates them itself.

export interface AccountBalance {
  account: AccountDto;
  balanceMinor: MinorUnitsString;
}

export interface CategoryAmount {
  category: CategoryDto;
  amountMinor: MinorUnitsString;
}

export interface MonthlyAmount {
  /** Short month label, e.g. "Oct". */
  month: string;
  amountMinor: MinorUnitsString;
}

export interface MonthSummary {
  periodLabel: string;
  totalBalanceMinor: MinorUnitsString;
  incomeMinor: MinorUnitsString;
  spendingMinor: MinorUnitsString;
  savedMinor: MinorUnitsString;
  /** Amount saved per month, oldest first. */
  savedTrend: readonly MonthlyAmount[];
}
