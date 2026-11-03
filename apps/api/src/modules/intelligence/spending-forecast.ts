import {
  divideRounded,
  INTELLIGENCE_RULES,
  serializeMinorUnits,
  type CategoryForecastDto,
  type IsoDateString,
} from '@calmcash/shared';

import {
  canEstimate,
  categoryActiveMonths,
  categorySeries,
  levelForMonths,
  type CategoryHistory,
  type History,
} from './history';
import { median, monthlyStatistics, trendOf } from './statistics';

// Category spending predictions for one calendar month:
//
//   expected remaining   = typical month × days still to come ÷ days in the month
//   estimated month end  = actual so far + expected remaining
//
// The typical month is the median of the category's completed history months (zeros included
// once recording had started), so one large purchase does not become a trend. Next month has no
// actual spending yet, so its estimate is the typical month itself. A category needs spending in
// at least two completed months for an estimate; otherwise only the actual amount is shown.

export interface PeriodShape {
  /** Days of the month up to and including today (0 for next month). */
  daysElapsed: number;
  daysInPeriod: number;
}

export interface CategoryActual {
  key: string;
  categoryId: string | null;
  name: string;
  archived: boolean;
  amountMinor: bigint;
}

export interface CategoryBudgetRef {
  budgetId: string;
  name: string;
  limitMinor: bigint;
}

/** The estimate of what is still to come in a category this period. */
export function expectedRemaining(typicalMinor: bigint, shape: PeriodShape): bigint {
  const remainingDays = Math.max(0, shape.daysInPeriod - shape.daysElapsed);
  return divideRounded(typicalMinor * BigInt(remainingDays), BigInt(shape.daysInPeriod));
}

export function forecastCategories(
  history: History,
  actuals: readonly CategoryActual[],
  shape: PeriodShape,
  budgets: ReadonlyMap<string, CategoryBudgetRef>,
): CategoryForecastDto[] {
  const overallEstimable = canEstimate(levelForMonths(history.months.length));
  const keys = new Set<string>([
    ...history.categories.keys(),
    ...actuals.map((entry) => entry.key),
  ]);
  const items: CategoryForecastDto[] = [];
  for (const key of keys) {
    const known: CategoryHistory | undefined = history.categories.get(key);
    const actual = actuals.find((entry) => entry.key === key);
    const months = known === undefined ? [] : categorySeries(history, known);
    const activeMonths = known === undefined ? 0 : categoryActiveMonths(history, known);
    const observations = months.reduce((total, month) => total + month.count, 0);
    const amounts = months.map((month) => month.amountMinor);
    const actualMinor = actual?.amountMinor ?? 0n;
    if (activeMonths === 0 && actualMinor === 0n) continue;
    const typical = median(amounts);
    const estimable = overallEstimable && activeMonths >= INTELLIGENCE_RULES.minCategoryMonths;
    const remaining = expectedRemaining(typical, shape);
    const categoryId = known?.categoryId ?? actual?.categoryId ?? null;
    const budget = categoryId === null ? undefined : budgets.get(categoryId);
    items.push({
      ...(categoryId === null ? {} : { categoryId }),
      name: known?.name ?? actual?.name ?? 'Uncategorised',
      archived: known?.archived ?? actual?.archived ?? false,
      history: monthlyStatistics(months),
      actualToDateMinor: serializeMinorUnits(actualMinor),
      estimate: estimable
        ? {
            status: 'available',
            expectedRemainingMinor: serializeMinorUnits(remaining),
            estimatedPeriodEndMinor: serializeMinorUnits(actualMinor + remaining),
          }
        : { status: 'unavailable', reason: 'insufficient_history' },
      trend: trendOf(amounts),
      observations,
      sufficiency: levelForMonths(activeMonths),
      ...(budget === undefined
        ? {}
        : {
            budget: {
              budgetId: budget.budgetId,
              name: budget.name,
              limitMinor: serializeMinorUnits(budget.limitMinor),
            },
          }),
    });
  }
  const endOf = (item: CategoryForecastDto): bigint =>
    item.estimate.status === 'available'
      ? BigInt(item.estimate.estimatedPeriodEndMinor)
      : BigInt(item.actualToDateMinor);
  return items.sort((a, b) => {
    const left = endOf(a);
    const right = endOf(b);
    return left === right ? a.name.localeCompare(b.name) : left > right ? -1 : 1;
  });
}

/** Days elapsed and days in the month for "this month" or "next month" seen from `today`. */
export function periodShape(
  period: 'this-month' | 'next-month',
  today: IsoDateString,
  daysInMonth: (date: IsoDateString) => number,
  nextMonthStart: IsoDateString,
): PeriodShape {
  return period === 'this-month'
    ? { daysElapsed: Number(today.slice(8, 10)), daysInPeriod: daysInMonth(today) }
    : { daysElapsed: 0, daysInPeriod: daysInMonth(nextMonthStart) };
}
