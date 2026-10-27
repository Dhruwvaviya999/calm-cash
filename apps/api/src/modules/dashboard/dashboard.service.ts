import {
  currencyCodeSchema,
  previousRange,
  serializeMinorUnits,
  trendGranularity,
  type AccountSummaryDto,
  type CalendarRange,
  type CurrencyCode,
  type DashboardCategoriesDto,
  type DashboardOverviewDto,
  type DashboardPeriodDto,
  type DashboardQuery,
  type DashboardTrendsDto,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import {
  chooseCurrency,
  compare,
  fillTrend,
  orderCurrencies,
  rankCategories,
  resolveRange,
  savingsRate,
  toCashFlowTotals,
  toWindow,
} from './dashboard-metrics';
import type { DashboardRepository } from './dashboard.repository';

export interface DashboardService {
  overview: (caller: Caller, query: DashboardQuery) => Promise<DashboardOverviewDto>;
  trends: (caller: Caller, query: DashboardQuery) => Promise<DashboardTrendsDto>;
  categories: (caller: Caller, query: DashboardQuery) => Promise<DashboardCategoriesDto>;
}

export interface DashboardServiceDependencies {
  repository: DashboardRepository;
  /**
   * The authoritative financial position (the accounts module's summary, built on
   * `account-balance.ts`), supplied by the composition root.
   */
  accountSummary: (caller: Caller) => Promise<AccountSummaryDto>;
  now: () => Date;
}

interface Scope {
  range: CalendarRange;
  period: DashboardPeriodDto;
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  accounts: { active: number; archived: number };
}

export function createDashboardService({
  repository,
  accountSummary,
  now,
}: DashboardServiceDependencies): DashboardService {
  /** Period and currency of a request, resolved once and used for every figure it returns. */
  const resolve = async (caller: Caller, query: DashboardQuery): Promise<Scope> => {
    const range = resolveRange(query, caller.timeZone, now());
    const owned = await repository.accountCurrencies(caller.userId);
    // Stored codes are always supported ones (validated whenever an account is written).
    const available = owned.currencies.map((code) => currencyCodeSchema.parse(code));
    return {
      range,
      period: { period: query.period, ...range, timeZone: caller.timeZone },
      currency: chooseCurrency(query.currency, available, caller.preferredCurrency),
      currencies: orderCurrencies(available, caller.preferredCurrency),
      accounts: { active: owned.active, archived: owned.archived },
    };
  };

  return {
    overview: async (caller, query) => {
      const scope = await resolve(caller, query);
      const earlier = previousRange(scope.range, query.period);
      const [position, hasTransactions, [current, previous]] = await Promise.all([
        accountSummary(caller),
        repository.hasTransactions(caller.userId),
        repository.cashFlowTotals(caller.userId, scope.currency, [
          toWindow(scope.range, caller.timeZone),
          toWindow(earlier, caller.timeZone),
        ]),
      ]);
      const empty = { incomeMinor: 0n, expenseMinor: 0n, incomeCount: 0, expenseCount: 0 };
      const now = current ?? empty;
      return {
        period: scope.period,
        currency: scope.currency,
        currencies: scope.currencies,
        position,
        accounts: scope.accounts,
        hasTransactions,
        cashFlow: toCashFlowTotals(now),
        savingsRate: savingsRate(now),
        comparison: compare(now, previous ?? empty, earlier),
      };
    },

    trends: async (caller, query) => {
      const scope = await resolve(caller, query);
      const granularity = trendGranularity(scope.range);
      const rows = await repository.cashFlowTrend(
        caller.userId,
        scope.currency,
        toWindow(scope.range, caller.timeZone),
        granularity,
        caller.timeZone,
      );
      return {
        period: scope.period,
        currency: scope.currency,
        granularity,
        buckets: fillTrend(scope.range, granularity, rows),
      };
    },

    categories: async (caller, query) => {
      const scope = await resolve(caller, query);
      const rows = await repository.expensesByCategory(
        caller.userId,
        scope.currency,
        toWindow(scope.range, caller.timeZone),
      );
      const breakdown = rankCategories(rows);
      return {
        period: scope.period,
        currency: scope.currency,
        totalExpenseMinor: serializeMinorUnits(breakdown.totalMinor),
        expenseCount: breakdown.count,
        entries: breakdown.entries,
      };
    },
  };
}
