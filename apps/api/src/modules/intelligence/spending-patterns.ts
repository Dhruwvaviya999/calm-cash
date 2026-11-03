import {
  calendarDateInTimeZone,
  divideRounded,
  monthsInRange,
  PATTERN_LIST_LIMIT,
  percentChangeBasisPoints,
  serializeMinorUnits,
  shareBasisPoints,
  type CalendarRange,
  type CategoryPatternDto,
  type CurrencyCode,
  type DataSufficiencyDto,
  type LargestExpenseDto,
  type MerchantPatternDto,
  type SpendingPatternPeriod,
  type SpendingPatternsDto,
} from '@calmcash/shared';

import type { CashFlowSums, CategoryRow, TrendRow } from '../dashboard/dashboard.repository';
import { UNCATEGORIZED_KEY } from './history';
import type {
  DistributionRow,
  LargestExpenseRow,
  MerchantRow,
  MonthlyCategoryRow,
  WeekdayRow,
} from './intelligence.repository';
import { PATTERN_METHODOLOGY } from './methodology';
import { mean, median } from './statistics';

// Historical spending analysis for a period: actual figures only, assembled from the database's
// aggregates. Category totals use the dashboard's own query (so the two pages always agree);
// merchant, distribution, and weekday figures come from this module's aggregates.

export interface PatternInput {
  period: SpendingPatternPeriod;
  range: CalendarRange;
  comparedTo: CalendarRange;
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  calculatedAt: string;
  timeZone: string;
  sufficiency: DataSufficiencyDto;
  totals: CashFlowSums;
  monthly: readonly TrendRow[];
  categories: readonly CategoryRow[];
  previousCategories: readonly CategoryRow[];
  categoryMonths: readonly MonthlyCategoryRow[];
  distribution: DistributionRow | null;
  largest: { overall: LargestExpenseRow | null; byCategory: readonly LargestExpenseRow[] };
  weekdays: readonly WeekdayRow[];
  merchants: readonly MerchantRow[];
}

function toLargest(row: LargestExpenseRow, timeZone: string): LargestExpenseDto {
  return {
    transactionId: row.transactionId,
    date: calendarDateInTimeZone(row.occurredAt, timeZone),
    description: row.description.slice(0, 255),
    ...(row.merchant === null ? {} : { merchant: row.merchant.slice(0, 120) }),
    amountMinor: serializeMinorUnits(row.amountMinor),
  };
}

export function buildPatterns(input: PatternInput): SpendingPatternsDto {
  const { currency, totals } = input;
  const months = monthsInRange(input.range);
  const totalExpense = totals.expenseMinor;
  const previousTotal = input.previousCategories.reduce((sum, row) => sum + row.totalMinor, 0n);
  const keyOf = (row: { categoryId: string | null }): string => row.categoryId ?? UNCATEGORIZED_KEY;
  const previous = new Map(input.previousCategories.map((row) => [keyOf(row), row]));
  const perMonth = new Map<string, Map<string, bigint>>();
  for (const row of input.categoryMonths) {
    if (row.type !== 'expense') continue;
    const key = keyOf(row);
    const entry = perMonth.get(key) ?? new Map<string, bigint>();
    entry.set(row.month, (entry.get(row.month) ?? 0n) + row.totalMinor);
    perMonth.set(key, entry);
  }
  const largestByCategory = new Map(
    input.largest.byCategory.map((row) => [row.categoryId ?? UNCATEGORIZED_KEY, row]),
  );

  const categories: CategoryPatternDto[] = [...input.categories]
    .sort((a, b) =>
      a.totalMinor === b.totalMinor
        ? (a.name ?? '').localeCompare(b.name ?? '')
        : a.totalMinor > b.totalMinor
          ? -1
          : 1,
    )
    .slice(0, 50)
    .map((row) => {
      const key = keyOf(row);
      const before = previous.get(key)?.totalMinor ?? 0n;
      const change = percentChangeBasisPoints(row.totalMinor, before);
      const monthly = months.map((month) => perMonth.get(key)?.get(month.month) ?? 0n);
      const share = shareBasisPoints(row.totalMinor, totalExpense);
      const largest = largestByCategory.get(key);
      return {
        ...(row.categoryId === null ? {} : { categoryId: row.categoryId }),
        name: row.name ?? 'Uncategorised',
        archived: row.archived,
        totalMinor: serializeMinorUnits(row.totalMinor),
        count: row.count,
        shareBasisPoints: share.toString(),
        previousTotalMinor: serializeMinorUnits(before),
        change:
          change === undefined
            ? { status: 'unavailable', reason: 'no_previous_value' }
            : { status: 'available', basisPoints: change.toString() },
        shareChangeBasisPoints: (share - shareBasisPoints(before, previousTotal)).toString(),
        averageMonthlyMinor: serializeMinorUnits(mean(monthly)),
        medianMonthlyMinor: serializeMinorUnits(median(monthly)),
        ...(largest === undefined ? {} : { largest: toLargest(largest, input.timeZone) }),
      };
    });

  const categoryTotals = new Map(
    input.categories.flatMap((row) =>
      row.categoryId === null ? [] : [[row.categoryId, row.totalMinor]],
    ),
  );
  const merchants: MerchantPatternDto[] = input.merchants.map((row) => {
    const categoryTotal =
      row.mainCategoryId === null ? undefined : categoryTotals.get(row.mainCategoryId);
    return {
      key: row.key.slice(0, 120),
      label: row.label.slice(0, 255) || row.key,
      totalMinor: serializeMinorUnits(row.totalMinor),
      count: row.count,
      averageMinor: serializeMinorUnits(
        row.count === 0 ? 0n : divideRounded(row.totalMinor, BigInt(row.count)),
      ),
      previousCount: row.previousCount,
      previousTotalMinor: serializeMinorUnits(row.previousTotalMinor),
      ...(row.mainCategoryName === null
        ? {}
        : { mainCategory: row.mainCategoryName.slice(0, 120) }),
      ...(categoryTotal === undefined || categoryTotal <= 0n
        ? {}
        : {
            shareOfCategoryBasisPoints: shareBasisPoints(
              row.mainCategoryMinor,
              categoryTotal,
            ).toString(),
          }),
      activeMonths: row.activeMonths,
    };
  });
  const bySpend = [...merchants]
    .sort((a, b) =>
      BigInt(a.totalMinor) === BigInt(b.totalMinor)
        ? a.key.localeCompare(b.key)
        : BigInt(a.totalMinor) > BigInt(b.totalMinor)
          ? -1
          : 1,
    )
    .slice(0, PATTERN_LIST_LIMIT);
  const byCount = [...merchants]
    .sort((a, b) => b.count - a.count || (BigInt(a.totalMinor) > BigInt(b.totalMinor) ? -1 : 1))
    .slice(0, PATTERN_LIST_LIMIT);

  const trend = new Map(input.monthly.map((row) => [row.bucket.slice(0, 7), row]));
  const distribution = input.distribution;
  const overall = input.largest.overall;

  return {
    period: input.period,
    from: input.range.from,
    to: input.range.to,
    comparedTo: input.comparedTo,
    currency,
    currencies: input.currencies,
    calculatedAt: input.calculatedAt,
    sufficiency: input.sufficiency,
    totals: {
      incomeMinor: serializeMinorUnits(totals.incomeMinor),
      expenseMinor: serializeMinorUnits(totals.expenseMinor),
      netMinor: serializeMinorUnits(totals.incomeMinor - totals.expenseMinor),
      incomeCount: totals.incomeCount,
      expenseCount: totals.expenseCount,
    },
    ...(distribution === null || overall === null
      ? {}
      : {
          distribution: {
            averageMinor: serializeMinorUnits(
              divideRounded(distribution.totalMinor, BigInt(distribution.count)),
            ),
            medianMinor: serializeMinorUnits(distribution.medianMinor),
            lowerQuartileMinor: serializeMinorUnits(distribution.lowerQuartileMinor),
            upperQuartileMinor: serializeMinorUnits(distribution.upperQuartileMinor),
            ninetiethMinor: serializeMinorUnits(distribution.ninetiethMinor),
            largest: toLargest(overall, input.timeZone),
            smallPayments: {
              thresholdMinor: serializeMinorUnits(distribution.lowerQuartileMinor),
              count: distribution.smallCount,
              totalMinor: serializeMinorUnits(distribution.smallTotalMinor),
              shareBasisPoints: shareBasisPoints(
                distribution.smallTotalMinor,
                distribution.totalMinor,
              ).toString(),
            },
          },
        }),
    monthly: months.map((month) => {
      const row = trend.get(month.month);
      const income = row?.incomeMinor ?? 0n;
      const expense = row?.expenseMinor ?? 0n;
      return {
        month: month.month,
        partial: month.partial,
        incomeMinor: serializeMinorUnits(income),
        expenseMinor: serializeMinorUnits(expense),
        netMinor: serializeMinorUnits(income - expense),
      };
    }),
    weekdays: [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const row = input.weekdays.find((entry) => entry.weekday === weekday);
      return {
        weekday,
        expenseMinor: serializeMinorUnits(row?.totalMinor ?? 0n),
        count: row?.count ?? 0,
      };
    }),
    categories,
    topMerchantsBySpend: bySpend,
    topMerchantsByCount: byCount,
    methodology: PATTERN_METHODOLOGY,
  };
}
