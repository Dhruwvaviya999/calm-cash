import {
  addDaysToIsoDate,
  budgetPeriodContaining,
  budgetWindow,
  BUDGET_SUMMARY_HIGHLIGHTS,
  calculateBudgetProgress,
  divideRounded,
  isRecurringBudgetPeriod,
  RECURRING_BUDGET_PERIODS,
  serializeMinorUnits,
  startOfDayInTimeZone,
  type BudgetPeriodTotalsDto,
  type BudgetProgressDto,
  type BudgetProgressStatus,
  type BudgetWindow,
  type BudgetWithProgressDto,
  type CurrencyCode,
  type IsoDateString,
  type RatioDto,
} from '@calmcash/shared';

import { toIsoDate } from '../../lib/calendar-dates';
import type { BudgetRecord, SpendingTotal, SpendingWindow } from './budgets.repository';

// Pure budget arithmetic: which period a budget shows, its progress, and summaries that never
// count the same spending twice. All money is `bigint`; nothing here reads the clock.

const BASIS_POINTS = 10_000n;

/** The period a budget shows for `referenceDate`, as calendar dates and as instants. */
export function windowOf(
  budget: Pick<BudgetRecord, 'id' | 'categoryId' | 'currency' | 'period' | 'startDate' | 'endDate'>,
  referenceDate: IsoDateString,
  timeZone: string,
): { window: BudgetWindow; spending: SpendingWindow } {
  const window = budgetWindow(
    {
      period: budget.period,
      startDate: toIsoDate(budget.startDate),
      endDate: budget.endDate === null ? undefined : toIsoDate(budget.endDate),
    },
    referenceDate,
  );
  return {
    window,
    spending: {
      budgetId: budget.id,
      categoryId: budget.categoryId,
      currency: budget.currency,
      start: startOfDayInTimeZone(window.from, timeZone),
      end: startOfDayInTimeZone(addDaysToIsoDate(window.to, 1), timeZone),
    },
  };
}

export function ratio(basisPoints: bigint | undefined, reason: 'no_limit' | 'no_target'): RatioDto {
  return basisPoints === undefined
    ? { status: 'unavailable', reason }
    : { status: 'available', basisPoints: basisPoints.toString() };
}

export function toProgressDto(
  budget: Pick<BudgetRecord, 'limitMinor' | 'alertThresholdsBp'>,
  window: BudgetWindow,
  spent: SpendingTotal,
): BudgetProgressDto {
  const figures = calculateBudgetProgress(
    budget.limitMinor,
    spent.totalMinor,
    budget.alertThresholdsBp,
    window.timing,
  );
  return {
    from: window.from,
    to: window.to,
    partial: window.partial,
    timing: window.timing,
    limitMinor: serializeMinorUnits(budget.limitMinor),
    spentMinor: serializeMinorUnits(spent.totalMinor),
    remainingMinor: serializeMinorUnits(figures.remainingMinor),
    used: ratio(figures.usedBasisPoints, 'no_limit'),
    status: figures.status,
    ...(figures.reachedThresholdBp === undefined
      ? {}
      : { reachedThresholdBp: figures.reachedThresholdBp }),
    transactionCount: spent.count,
  };
}

/** `[a, b]` and `[c, d]` share at least one day; `undefined` ends are open. */
export function datesOverlap(
  a: { start: IsoDateString; end: IsoDateString | undefined },
  b: { start: IsoDateString; end: IsoDateString | undefined },
): boolean {
  return (b.end === undefined || a.start <= b.end) && (a.end === undefined || b.start <= a.end);
}

/** Currencies of current budgets, the preferred one first, then alphabetically. */
export function budgetCurrencies(
  items: readonly BudgetWithProgressDto[],
  preferred: CurrencyCode,
): CurrencyCode[] {
  const currencies = [
    ...new Set(
      items
        .filter((item) => item.budget.status === 'active' && item.progress.timing === 'current')
        .map((item) => item.budget.currency),
    ),
  ];
  return currencies.sort((a, b) =>
    a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b),
  );
}

function used(limitMinor: bigint, spentMinor: bigint): RatioDto {
  return ratio(
    limitMinor > 0n ? divideRounded(spentMinor * BASIS_POINTS, limitMinor) : undefined,
    'no_limit',
  );
}

/**
 * Totals for one cadence without double counting. An overall budget already covers every expense,
 * so it alone gives the totals. Otherwise the category budgets are added up, leaving out a
 * subcategory budget whose parent also has a budget (its spending is inside the parent's). Budgets
 * that remain have disjoint scopes, so their spending can be added exactly.
 */
export function periodTotals(
  items: readonly BudgetWithProgressDto[],
  period: BudgetPeriodTotalsDto['period'],
  referenceDate: IsoDateString,
): BudgetPeriodTotalsDto | undefined {
  const group = items.filter((item) => item.budget.period === period);
  if (group.length === 0) {
    return undefined;
  }
  const overall = group.filter((item) => item.budget.categoryId === undefined);
  const covered = new Set(group.flatMap((item) => item.budget.categoryId ?? []));
  const counted =
    overall.length > 0
      ? overall
      : group.filter(
          (item) => item.category?.parentId === undefined || !covered.has(item.category.parentId),
        );
  const limitMinor = counted.reduce((sum, item) => sum + BigInt(item.budget.limitMinor), 0n);
  const spentMinor = counted.reduce((sum, item) => sum + BigInt(item.progress.spentMinor), 0n);
  const calendar = budgetPeriodContaining(period, referenceDate);
  return {
    period,
    from: calendar.from,
    to: calendar.to,
    budgetCount: group.length,
    scope: overall.length > 0 ? 'overall' : 'categories',
    limitMinor: serializeMinorUnits(limitMinor),
    spentMinor: serializeMinorUnits(spentMinor),
    remainingMinor: serializeMinorUnits(limitMinor - spentMinor),
    used: used(limitMinor, spentMinor),
  };
}

function usedBasisPoints(item: BudgetWithProgressDto): bigint {
  return item.progress.used.status === 'available' ? BigInt(item.progress.used.basisPoints) : -1n;
}

export interface BudgetSummaryParts {
  statusCounts: Record<BudgetProgressStatus, number>;
  totals: BudgetPeriodTotalsDto[];
  highlights: BudgetWithProgressDto[];
}

/** Summary of the active budgets in one currency whose shown period is current. */
export function summarize(
  items: readonly BudgetWithProgressDto[],
  currency: CurrencyCode | undefined,
  referenceDate: IsoDateString,
): BudgetSummaryParts {
  const current = items.filter(
    (item) =>
      item.budget.status === 'active' &&
      item.progress.timing === 'current' &&
      item.budget.currency === currency,
  );
  const statusCounts: Record<BudgetProgressStatus, number> = {
    on_track: 0,
    approaching_limit: 0,
    limit_reached: 0,
    over_budget: 0,
    not_applicable: 0,
  };
  for (const item of current) {
    statusCounts[item.progress.status] += 1;
  }
  const recurring = current.filter((item) => isRecurringBudgetPeriod(item.budget.period));
  return {
    statusCounts,
    totals: RECURRING_BUDGET_PERIODS.flatMap(
      (period) => periodTotals(recurring, period, referenceDate) ?? [],
    ),
    highlights: [...current]
      .sort((a, b) => {
        const difference = usedBasisPoints(b) - usedBasisPoints(a);
        return difference > 0n
          ? 1
          : difference < 0n
            ? -1
            : a.budget.name.localeCompare(b.budget.name);
      })
      .slice(0, BUDGET_SUMMARY_HIGHLIGHTS),
  };
}
