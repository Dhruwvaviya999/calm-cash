import {
  BUDGET_REVIEW_PERIODS,
  INTELLIGENCE_RULES,
  serializeMinorUnits,
  shareBasisPoints,
  type BudgetFlagDto,
  type BudgetPeriodResultDto,
  type BudgetProgressStatus,
  type BudgetRecommendationDto,
  type BudgetSuggestionDto,
  type CurrencyCode,
} from '@calmcash/shared';

import { formatMoney } from '../../lib/text-format';
import {
  categoryActiveMonths,
  categorySeries,
  levelForMonths,
  series,
  type CategoryHistory,
  type History,
} from './history';
import {
  highest,
  lowerQuartile,
  lowest,
  mean,
  median,
  monthlyStatistics,
  roundUpToStep,
  trendOf,
  type MonthAmount,
} from './statistics';

// Budget suggestions from completed months, as planning starting points (never optimal values):
//
// - historical average: the mean monthly spending, rounded up to a readable step;
// - conservative: the lower quartile of monthly spending, rounded up — an amount already managed
//   in at least a quarter of those months.
//
// Each suggestion says how many past months stayed within it. Flags describe budget performance
// over the last four completed monthly periods; an unused budget is reported as unused, never as
// unnecessary (it may be planned for later spending). Nothing here creates or changes a budget:
// the prefill only opens the ordinary form.

/** A category needs this share of average monthly spending to be suggested without a budget. */
const NEW_BUDGET_MIN_SHARE_BP = 1_000n;

export interface MonthlyBudgetRef {
  budgetId: string;
  name: string;
  /** Null for an all-spending budget. */
  categoryId: string | null;
  limitMinor: bigint;
  /** Completed monthly periods, oldest first (only those inside the budget's lifetime). */
  recent: {
    from: string;
    to: string;
    spentMinor: bigint;
    limitMinor: bigint;
    status: BudgetProgressStatus;
  }[];
}

export function suggestionsFor(
  months: readonly MonthAmount[],
  currency: CurrencyCode,
): BudgetSuggestionDto[] {
  const amounts = months.map((month) => month.amountMinor);
  if (amounts.length === 0) return [];
  const within = (limit: bigint): number => amounts.filter((amount) => amount <= limit).length;
  const average = roundUpToStep(mean(amounts), currency);
  const suggestions: BudgetSuggestionDto[] = [];
  if (average > 0n) {
    suggestions.push({
      basis: 'historical_average',
      limitMinor: serializeMinorUnits(average),
      monthsWithin: within(average),
      monthsConsidered: amounts.length,
      explanation: `Your average month (${formatMoney(mean(amounts), currency)}), rounded up.`,
    });
  }
  const quartile = lowerQuartile(amounts);
  const conservative = roundUpToStep(quartile < mean(amounts) ? quartile : mean(amounts), currency);
  if (conservative > 0n && conservative < average) {
    suggestions.push({
      basis: 'conservative',
      limitMinor: serializeMinorUnits(conservative),
      monthsWithin: within(conservative),
      monthsConsidered: amounts.length,
      explanation: `Your lower-spending months (lower quartile ${formatMoney(quartile, currency)}), rounded up: an amount you already managed.`,
    });
  }
  return suggestions;
}

export function budgetFlags(
  months: readonly MonthAmount[],
  budget: MonthlyBudgetRef | undefined,
  currency: CurrencyCode,
): BudgetFlagDto[] {
  const amounts = months.map((month) => month.amountMinor);
  const flags: BudgetFlagDto[] = [];
  if (budget !== undefined) {
    const reviewed = budget.recent.slice(-BUDGET_REVIEW_PERIODS);
    const over = reviewed.filter((period) => period.status === 'over_budget').length;
    if (reviewed.length >= 2 && over >= 2) {
      flags.push({
        code: 'repeated_overspending',
        message: `Over its limit in ${over.toString()} of the last ${reviewed.length.toString()} completed months.`,
      });
    }
    if (
      reviewed.length >= 3 &&
      reviewed.every((period) => period.spentMinor * 2n < period.limitMinor)
    ) {
      flags.push({
        code: 'consistently_unused',
        message: `Less than half used in each of the last ${reviewed.length.toString()} completed months. It may be meant for planned spending, so this is not a reason to remove it by itself.`,
      });
    }
    if (amounts.length >= 3 && budget.limitMinor < lowerQuartile(amounts)) {
      flags.push({
        code: 'limit_below_typical',
        message: `The limit (${formatMoney(budget.limitMinor, currency)}) is below even your lower-spending months (${formatMoney(lowerQuartile(amounts), currency)}).`,
      });
    }
  }
  if (trendOf(amounts) === 'rising') {
    flags.push({
      code: 'rising_spending',
      message:
        'Spending in the last three months was at least 20 % higher than in the three before.',
    });
  }
  if (amounts.length >= 3 && highest(amounts) - lowest(amounts) > median(amounts)) {
    flags.push({
      code: 'high_variability',
      message: `Monthly spending varied from ${formatMoney(lowest(amounts), currency)} to ${formatMoney(highest(amounts), currency)}.`,
    });
  }
  return flags;
}

function toPeriodResults(budget: MonthlyBudgetRef): BudgetPeriodResultDto[] {
  return budget.recent.slice(-BUDGET_REVIEW_PERIODS).map((period) => ({
    from: period.from,
    to: period.to,
    spentMinor: serializeMinorUnits(period.spentMinor),
    limitMinor: serializeMinorUnits(period.limitMinor),
    status: period.status,
  }));
}

function recommendation(
  key: string,
  categoryId: string | null,
  name: string,
  months: MonthAmount[],
  activeMonths: number,
  budget: MonthlyBudgetRef | undefined,
  currency: CurrencyCode,
): BudgetRecommendationDto {
  const suggestions = suggestionsFor(months, currency);
  const average = suggestions.find((entry) => entry.basis === 'historical_average');
  const reviewed = budget === undefined ? [] : toPeriodResults(budget);
  return {
    key,
    ...(categoryId === null ? {} : { categoryId }),
    categoryName: name,
    currency,
    history: monthlyStatistics(months),
    ...(budget === undefined
      ? {}
      : {
          existingBudget: {
            budgetId: budget.budgetId,
            name: budget.name,
            limitMinor: serializeMinorUnits(budget.limitMinor),
            recentPeriods: reviewed,
            overCount: reviewed.filter((period) => period.status === 'over_budget').length,
          },
        }),
    suggestions,
    flags: budgetFlags(months, budget, currency),
    sufficiency: levelForMonths(activeMonths),
    prefill: {
      ...(budget === undefined ? {} : { budgetId: budget.budgetId }),
      ...(categoryId === null ? {} : { categoryId }),
      name: (budget?.name ?? (categoryId === null ? 'All spending' : name)).slice(0, 100),
      currency,
      period: 'monthly',
      limitMinor: average?.limitMinor ?? serializeMinorUnits(budget?.limitMinor ?? 0n),
    },
  };
}

/**
 * Recommendations for every category with a monthly budget in the currency (and the all-spending
 * budget), plus categories without one that take at least 10 % of average monthly spending and
 * had spending in at least two completed months.
 */
export function recommendBudgets(
  history: History,
  budgets: readonly MonthlyBudgetRef[],
  currency: CurrencyCode,
): BudgetRecommendationDto[] {
  const byCategory = new Map(
    budgets.flatMap((budget) => (budget.categoryId === null ? [] : [[budget.categoryId, budget]])),
  );
  const spent = series(history, (totals) => totals.expenseMinor);
  const totalMonths: MonthAmount[] = history.months.map((month, index) => ({
    month,
    amountMinor: spent[index] ?? 0n,
    count: history.totals.get(month)?.expenseCount ?? 0,
  }));
  const averageTotal = mean(totalMonths.map((month) => month.amountMinor));
  const items: BudgetRecommendationDto[] = [];

  for (const budget of budgets.filter((entry) => entry.categoryId === null)) {
    const active = totalMonths.filter((month) => month.count > 0).length;
    items.push(
      recommendation(
        `budget:${budget.budgetId}`,
        null,
        'All spending',
        totalMonths,
        active,
        budget,
        currency,
      ),
    );
  }

  for (const category of history.categories.values()) {
    if (category.categoryId === null) continue;
    const months = categorySeries(history, category);
    const active = categoryActiveMonths(history, category);
    const budget = byCategory.get(category.categoryId);
    if (budget === undefined) {
      const share = shareBasisPoints(mean(months.map((month) => month.amountMinor)), averageTotal);
      if (
        active < INTELLIGENCE_RULES.minCategoryMonths ||
        share < NEW_BUDGET_MIN_SHARE_BP ||
        category.archived
      ) {
        continue;
      }
    }
    items.push(
      recommendation(
        budget === undefined
          ? `category:${currency}:${category.categoryId}`
          : `budget:${budget.budgetId}`,
        category.categoryId,
        category.name,
        months,
        active,
        budget,
        currency,
      ),
    );
  }

  // Budgets whose category had no spending in the history still get their performance shown.
  for (const [categoryId, budget] of byCategory) {
    if (history.categories.has(categoryId)) continue;
    const empty: CategoryHistory = {
      key: categoryId,
      categoryId,
      name: budget.name,
      archived: false,
      months: new Map(),
    };
    items.push(
      recommendation(
        `budget:${budget.budgetId}`,
        categoryId,
        budget.name,
        categorySeries(history, empty),
        0,
        budget,
        currency,
      ),
    );
  }

  const priority = (item: BudgetRecommendationDto): number =>
    item.flags.some((flag) => flag.code === 'repeated_overspending')
      ? 0
      : item.existingBudget === undefined
        ? 2
        : 1;
  const average = (item: BudgetRecommendationDto): bigint => BigInt(item.history.averageMinor);
  return items.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (average(a) === average(b) ? 0 : average(a) > average(b) ? -1 : 1) ||
      a.categoryName.localeCompare(b.categoryName),
  );
}
