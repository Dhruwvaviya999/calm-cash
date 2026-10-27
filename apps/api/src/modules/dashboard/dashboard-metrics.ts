import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  DASHBOARD_CATEGORY_LIMIT,
  percentChangeBasisPoints,
  presetRange,
  savingsRateBasisPoints,
  serializeMinorUnits,
  shareBasisPoints,
  startOfDayInTimeZone,
  trendBuckets,
  type CalendarRange,
  type CashFlowTotalsDto,
  type CategorySpendEntryDto,
  type CurrencyCode,
  type DashboardQuery,
  type MetricChangeDto,
  type PeriodComparisonDto,
  type RatioDto,
  type RatioUnavailableReason,
  type TrendBucketDto,
  type TrendGranularity,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { CashFlowSums, CategoryRow, InstantWindow, TrendRow } from './dashboard.repository';

// The dashboard's definitions, as pure functions over aggregated sums. The repository adds up;
// these decide what the sums mean. Nothing here touches the database or the clock.

const EARLIEST_DATE = '1900-01-01';

function invalid(path: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
    details: [{ path: `query.${path}`, message }],
  });
}

/** The calendar range a query asks for, checked against "today" in the user's time zone. */
export function resolveRange(query: DashboardQuery, timeZone: string, now: Date): CalendarRange {
  const today = calendarDateInTimeZone(now, timeZone);
  if (query.period !== 'custom') {
    return presetRange(query.period, today);
  }
  // The schema guarantees both dates for a custom period; this keeps the types honest.
  if (query.from === undefined || query.to === undefined) {
    throw invalid('from', 'A custom period needs a start and an end date.');
  }
  if (query.to > today) {
    throw invalid('to', 'The end date cannot be in the future.');
  }
  if (query.from < EARLIEST_DATE) {
    throw invalid('from', 'Choose a date after 1900.');
  }
  return { from: query.from, to: query.to };
}

/** The instants of a calendar range in the user's time zone: start inclusive, end exclusive. */
export function toWindow(range: CalendarRange, timeZone: string): InstantWindow {
  return {
    start: startOfDayInTimeZone(range.from, timeZone),
    end: startOfDayInTimeZone(addDaysToIsoDate(range.to, 1), timeZone),
  };
}

/** Currencies to offer: the preferred one first (when the user has it), then alphabetical. */
export function orderCurrencies(
  available: readonly CurrencyCode[],
  preferred: CurrencyCode,
): CurrencyCode[] {
  const sorted = [...available].sort();
  return sorted.includes(preferred)
    ? [preferred, ...sorted.filter((currency) => currency !== preferred)]
    : sorted;
}

/** The requested currency, else the preferred one if the user has it, else their first one. */
export function chooseCurrency(
  requested: CurrencyCode | undefined,
  available: readonly CurrencyCode[],
  preferred: CurrencyCode,
): CurrencyCode {
  if (requested !== undefined) {
    return requested;
  }
  return available.length === 0 || available.includes(preferred)
    ? preferred
    : (available[0] ?? preferred);
}

function ratio(value: bigint | undefined, reason: RatioUnavailableReason): RatioDto {
  return value === undefined
    ? { status: 'unavailable', reason }
    : { status: 'available', basisPoints: value.toString() };
}

export function toCashFlowTotals(sums: CashFlowSums): CashFlowTotalsDto {
  return {
    incomeMinor: serializeMinorUnits(sums.incomeMinor),
    expenseMinor: serializeMinorUnits(sums.expenseMinor),
    netMinor: serializeMinorUnits(sums.incomeMinor - sums.expenseMinor),
    incomeCount: sums.incomeCount,
    expenseCount: sums.expenseCount,
  };
}

/** Savings rate = (income − expenses) ÷ income; unavailable without income. */
export function savingsRate(sums: CashFlowSums): RatioDto {
  return ratio(savingsRateBasisPoints(sums.incomeMinor, sums.expenseMinor), 'no_income');
}

function change(current: bigint, previous: bigint): MetricChangeDto {
  return {
    previousMinor: serializeMinorUnits(previous),
    changeMinor: serializeMinorUnits(current - previous),
    changePercent: ratio(percentChangeBasisPoints(current, previous), 'no_previous_value'),
  };
}

/** Change against the comparable earlier period, or why there is nothing to compare with. */
export function compare(
  current: CashFlowSums,
  previous: CashFlowSums,
  previousRange: CalendarRange,
): PeriodComparisonDto {
  if (previous.incomeCount + previous.expenseCount === 0) {
    return { status: 'unavailable', ...previousRange, reason: 'no_previous_activity' };
  }
  const currentNet = current.incomeMinor - current.expenseMinor;
  const previousNet = previous.incomeMinor - previous.expenseMinor;
  return {
    status: 'available',
    ...previousRange,
    income: change(current.incomeMinor, previous.incomeMinor),
    expense: change(current.expenseMinor, previous.expenseMinor),
    net: {
      previousMinor: serializeMinorUnits(previousNet),
      changeMinor: serializeMinorUnits(currentNet - previousNet),
    },
  };
}

/** Every bucket of the range, with zero where nothing was recorded (a real zero, not a gap). */
export function fillTrend(
  range: CalendarRange,
  granularity: TrendGranularity,
  rows: readonly TrendRow[],
): TrendBucketDto[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return trendBuckets(range, granularity).map((bucket) => {
    const row = byBucket.get(bucket.key);
    const income = row?.incomeMinor ?? 0n;
    const expense = row?.expenseMinor ?? 0n;
    return {
      start: bucket.start,
      end: bucket.end,
      partial: bucket.partial,
      incomeMinor: serializeMinorUnits(income),
      expenseMinor: serializeMinorUnits(expense),
      netMinor: serializeMinorUnits(income - expense),
    };
  });
}

export interface CategoryBreakdown {
  totalMinor: bigint;
  count: number;
  entries: CategorySpendEntryDto[];
}

/**
 * Ranks category spending (largest first, ties by name, uncategorised spending competing like any
 * category), lists up to `limit` entries by name and adds the rest, exactly, into "Other". A
 * single leftover category is shown by name rather than hidden in "Other".
 */
export function rankCategories(
  rows: readonly CategoryRow[],
  limit: number = DASHBOARD_CATEGORY_LIMIT,
): CategoryBreakdown {
  const totalMinor = rows.reduce((sum, row) => sum + row.totalMinor, 0n);
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const ranked = [...rows].sort((a, b) => {
    if (a.totalMinor !== b.totalMinor) {
      return a.totalMinor > b.totalMinor ? -1 : 1;
    }
    return (
      (a.name ?? '').localeCompare(b.name ?? '', 'en') ||
      (a.categoryId ?? '').localeCompare(b.categoryId ?? '')
    );
  });
  const shown = ranked.length <= limit + 1 ? ranked : ranked.slice(0, limit);
  const rest = ranked.slice(shown.length);

  const base = (
    amount: bigint,
    transactions: number,
  ): {
    amountMinor: string;
    transactionCount: number;
    shareBasisPoints: string;
  } => ({
    amountMinor: serializeMinorUnits(amount),
    transactionCount: transactions,
    shareBasisPoints: shareBasisPoints(amount, totalMinor).toString(),
  });

  const entries: CategorySpendEntryDto[] = shown.map((row) =>
    row.categoryId === null || row.name === null
      ? { kind: 'uncategorized', ...base(row.totalMinor, row.count) }
      : {
          kind: 'category',
          categoryId: row.categoryId,
          name: row.name,
          archived: row.archived,
          ...base(row.totalMinor, row.count),
        },
  );
  if (rest.length > 0) {
    entries.push({
      kind: 'other',
      categoryCount: rest.length,
      ...base(
        rest.reduce((sum, row) => sum + row.totalMinor, 0n),
        rest.reduce((sum, row) => sum + row.count, 0),
      ),
    });
  }
  return { totalMinor, count, entries };
}
