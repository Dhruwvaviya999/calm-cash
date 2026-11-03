import { describe, expect, it } from 'vitest';

import {
  bucketBounds,
  forecastCashFlow,
  type ForecastInput,
  type PendingOccurrence,
} from './cash-flow-forecast';
import { buildHistory, eligibleMonths, sufficiencyOf, variableSpendingSeries } from './history';
import type { MonthlyCategoryRow } from './intelligence.repository';
import { lowerQuartile, mean, prorate, roundUpToStep, tenthsText, trendOf } from './statistics';

// Fixed dates and hand-computed expectations: every expected figure below is worked out in the
// comment next to it, not by calling the code under test.

const FOOD = '0190a1b2-0000-7000-8000-00000000f00d';
const RENT = '0190a1b2-0000-7000-8000-0000000000e1';

function row(
  month: string,
  type: 'income' | 'expense',
  totalMinor: bigint,
  options: Partial<Pick<MonthlyCategoryRow, 'categoryId' | 'name' | 'scheduled' | 'count'>> = {},
): MonthlyCategoryRow {
  return {
    month,
    type,
    categoryId: options.categoryId ?? (type === 'expense' ? FOOD : null),
    name: options.name ?? (type === 'expense' ? 'Food' : null),
    archived: false,
    scheduled: options.scheduled ?? false,
    totalMinor,
    count: options.count ?? 4,
  };
}

/** Six completed months (May–October 2026) of food spending, plus scheduled rent and salary. */
function sixMonths(food: readonly bigint[]): MonthlyCategoryRow[] {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  return months.flatMap((month, index) => [
    row(month, 'expense', food[index] ?? 0n),
    row(month, 'expense', 2_000_000n, {
      categoryId: RENT,
      name: 'Rent',
      scheduled: true,
      count: 1,
    }),
    row(month, 'income', 6_000_000n, { scheduled: true, count: 1 }),
  ]);
}

function pending(overrides: Partial<PendingOccurrence>): PendingOccurrence {
  return {
    scheduleId: '0190a1b2-0000-7000-8000-0000000000a1',
    currency: 'INR',
    name: 'Rent',
    type: 'expense',
    isSubscription: false,
    categoryId: RENT,
    scheduledDate: '2026-11-05',
    dueDate: '2026-11-05',
    status: 'upcoming',
    postponed: false,
    amountMinor: 2_000_000n,
    ...overrides,
  };
}

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    currency: 'INR',
    today: '2026-11-03',
    horizonDays: 30,
    incomeBasis: 'scheduled',
    heldMinor: 10_000_000n,
    owedMinor: 1_000_000n,
    monthToDate: { from: '2026-11-01', to: '2026-11-03', incomeMinor: 0n, expenseMinor: 50_000n },
    pending: [],
    pendingTruncated: false,
    history: buildHistory(
      sixMonths([300_000n, 310_000n, 290_000n, 300_000n, 305_000n, 295_000n]),
      '2026-11-03',
      '2026-05-01',
    ),
    ...overrides,
  };
}

describe('statistics', () => {
  it('spreads a monthly amount over days at 365.25 ÷ 12 days per month, exactly', () => {
    // 300 000 × 30 × 48 ÷ 1461 = 432 000 000 ÷ 1461 = 295 687.89… → 295 688
    expect(prorate(300_000n, 30)).toBe(295_688n);
    // 365 days are a little under twelve average months: 100 × 365 × 48 ÷ 1461 = 1 199.17… → 1 199
    expect(prorate(100n, 365)).toBe(1_199n);
    expect(prorate(100n, 0)).toBe(0n);
  });

  it('rounds suggested limits up to a readable step in the currency', () => {
    expect(roundUpToStep(451_240n, 'INR')).toBe(460_000n); // ₹4,512.40 → ₹4,600
    expect(roundUpToStep(31_200n, 'INR')).toBe(32_000n); // ₹312 → ₹320
    expect(roundUpToStep(87n, 'JPY')).toBe(87n); // ¥87 stays (step ¥1)
    expect(roundUpToStep(1_234n, 'JPY')).toBe(1_300n); // ¥1,234 → ¥1,300
    expect(roundUpToStep(0n, 'INR')).toBe(0n);
  });

  it('calls a trend only from six months and a 20 % change of medians', () => {
    expect(trendOf([100n, 100n, 100n, 100n, 100n])).toBe('unknown');
    expect(trendOf([100n, 100n, 100n, 120n, 125n, 130n])).toBe('rising'); // +25 %
    expect(trendOf([100n, 100n, 100n, 110n, 110n, 110n])).toBe('stable'); // +10 %
    expect(trendOf([100n, 100n, 100n, 70n, 80n, 75n])).toBe('falling'); // −25 %
    // One large purchase does not make a trend: the median ignores it.
    expect(trendOf([100n, 100n, 100n, 100n, 5_000n, 100n])).toBe('stable');
  });

  it('computes means and nearest-rank quartiles without floating point', () => {
    expect(mean([1n, 2n])).toBe(2n); // 1.5 rounds half away from zero
    expect(lowerQuartile([400_000n, 450_000n, 500_000n, 600_000n])).toBe(400_000n);
    expect(tenthsText(25n, 10n)).toBe('2.5');
    expect(tenthsText(1n, 0n)).toBeUndefined();
  });
});

describe('history and data sufficiency', () => {
  it('ignores months before recording began and a late-started first month', () => {
    const considered = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    expect(eligibleMonths(considered, '2026-07-05')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(eligibleMonths(considered, '2026-07-20')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(eligibleMonths(considered, undefined)).toEqual([]);
  });

  it('classifies sufficiency from completed months and expense counts', () => {
    const level = (rows: MonthlyCategoryRow[], first: string): string =>
      sufficiencyOf(buildHistory(rows, '2026-11-03', first)).level;
    expect(level([], '2026-11-01')).toBe('insufficient');
    expect(level([row('2026-10', 'expense', 1000n, { count: 20 })], '2026-10-01')).toBe(
      'insufficient',
    );
    expect(
      level(
        [
          row('2026-09', 'expense', 1000n, { count: 6 }),
          row('2026-10', 'expense', 1000n, { count: 6 }),
        ],
        '2026-09-01',
      ),
    ).toBe('limited');
    // Two months but only four expenses in total: too few to estimate.
    expect(
      level(
        [
          row('2026-09', 'expense', 1000n, { count: 2 }),
          row('2026-10', 'expense', 1000n, { count: 2 }),
        ],
        '2026-09-01',
      ),
    ).toBe('insufficient');
    expect(level(sixMonths([1n, 1n, 1n, 1n, 1n, 1n]).slice(9), '2026-08-01')).toBe('moderate');
    expect(level(sixMonths([1n, 1n, 1n, 1n, 1n, 1n]), '2026-05-01')).toBe('strong');
  });

  it('keeps spending recorded from schedules out of the everyday baseline (no double counting)', () => {
    const history = buildHistory(
      sixMonths([300_000n, 300_000n, 300_000n, 300_000n, 300_000n, 300_000n]),
      '2026-11-03',
      '2026-05-01',
    );
    // Rent (2,000,000) was recorded from its schedule every month; only food is everyday spending.
    expect(variableSpendingSeries(history)).toEqual([
      300_000n,
      300_000n,
      300_000n,
      300_000n,
      300_000n,
      300_000n,
    ]);
  });
});

describe('cash-flow forecast', () => {
  it('adds scheduled income, subtracts scheduled bills and typical everyday spending', () => {
    const result = forecastCashFlow(
      input({
        pending: [
          pending({}),
          pending({
            scheduleId: 's2',
            name: 'Salary',
            type: 'income',
            dueDate: '2026-11-28',
            scheduledDate: '2026-11-28',
            amountMinor: 6_000_000n,
          }),
        ],
      }),
    );
    // Median of 290 000…310 000 (sorted 290, 295, 300, 300, 305, 310 thousand) = 300 000.
    // Variable over 30 days = 295 688 (see the statistics test).
    // Net now 10 000 000 − 1 000 000 = 9 000 000; + 6 000 000 − 2 000 000 − 295 688 = 12 704 312.
    expect(result.starting.netPositionMinor).toBe('9000000');
    expect(result.variableSpending).toMatchObject({
      status: 'available',
      monthlyBaselineMinor: '300000',
      amountMinor: '295688',
    });
    expect(result.expectedIncomeMinor).toBe('6000000');
    expect(result.expectedExpensesMinor).toBe('2295688');
    expect(result.projected.endingPositionMinor).toBe('12704312');
    // The last bucket ends exactly at the projection (cumulative proration never loses a unit).
    expect(result.buckets.at(-1)?.projectedPositionMinor).toBe('12704312');
    expect(result.buckets).toHaveLength(31); // today and the 30 days after it
  });

  it('counts overdue bills as still to pay but never assumes overdue income', () => {
    const result = forecastCashFlow(
      input({
        pending: [
          pending({ status: 'overdue', dueDate: '2026-10-30', scheduledDate: '2026-10-30' }),
          pending({
            scheduleId: 's2',
            name: 'Salary',
            type: 'income',
            status: 'overdue',
            dueDate: '2026-10-31',
            scheduledDate: '2026-10-31',
            amountMinor: 6_000_000n,
          }),
        ],
      }),
    );
    expect(result.scheduledExpenses).toMatchObject({ amountMinor: '2000000', overdueCount: 1 });
    expect(result.scheduledIncome.amountMinor).toBe('0');
    expect(result.overdueIncomeNotCounted).toEqual({ amountMinor: '6000000', count: 1 });
    expect(result.items.find((item) => item.type === 'income')?.counted).toBe(false);
    expect(result.buckets[0]?.scheduledExpenseMinor).toBe('2000000'); // overdue falls on today
    expect(result.warnings.map((warning) => warning.code)).toContain('overdue_items');
  });

  it('projects only scheduled amounts when history is insufficient', () => {
    const result = forecastCashFlow(
      input({ history: buildHistory([], '2026-11-03', undefined), pending: [pending({})] }),
    );
    expect(result.variableSpending).toEqual({
      status: 'unavailable',
      reason: 'insufficient_history',
    });
    expect(result.projected.endingPositionMinor).toBe('7000000'); // 9 000 000 − 2 000 000
    expect(result.projected.lowMinor).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain('insufficient_history');
  });

  it('shows a negative projection with zero income instead of hiding it', () => {
    const history = buildHistory(
      ['2026-08', '2026-09', '2026-10'].map((month) =>
        row(month, 'expense', 3_000_000n, { count: 10 }),
      ),
      '2026-11-03',
      '2026-08-01',
    );
    const result = forecastCashFlow(input({ heldMinor: 500_000n, owedMinor: 0n, history }));
    // 500 000 − 3 000 000 × 30 × 48 ÷ 1461 (= 2 956 878.85… → 2 956 879) = −2 456 879
    expect(result.projected.endingPositionMinor).toBe('-2456879');
    expect(result.expectedIncomeMinor).toBe('0');
  });

  it('adds typical unscheduled income only when asked to, and says so', () => {
    const history = buildHistory(
      ['2026-08', '2026-09', '2026-10'].flatMap((month) => [
        row(month, 'expense', 100_000n, { count: 10 }),
        row(month, 'income', 1_461_000n, { count: 2 }),
      ]),
      '2026-11-03',
      '2026-08-01',
    );
    const excluded = forecastCashFlow(input({ history }));
    const included = forecastCashFlow(input({ history, incomeBasis: 'scheduled_and_estimated' }));
    expect(excluded.estimatedIncome).toMatchObject({ status: 'excluded' });
    expect(excluded.expectedIncomeMinor).toBe('0');
    // 1 461 000 × 30 × 48 ÷ 1461 = 1 440 000 exactly.
    expect(included.estimatedIncome).toMatchObject({ status: 'included', amountMinor: '1440000' });
    expect(included.expectedIncomeMinor).toBe('1440000');
    expect(included.warnings.map((warning) => warning.code)).toContain('estimated_income_included');
  });

  it('flags irregular income and schedule-heavy projections', () => {
    const history = buildHistory(
      ['2026-08', '2026-09', '2026-10'].flatMap((month, index) => [
        row(month, 'expense', 10_000n, { count: 10 }),
        row(month, 'income', [1_000_000n, 4_000_000n, 1_200_000n][index] ?? 0n, { count: 1 }),
      ]),
      '2026-11-03',
      '2026-08-01',
    );
    const codes = forecastCashFlow(input({ history, pending: [pending({})] })).warnings.map(
      (warning) => warning.code,
    );
    expect(codes).toContain('irregular_income');
    expect(codes).toContain('schedule_heavy');
    expect(codes).toContain('account_allocation');
  });

  it('crosses month ends and leap days on calendar dates', () => {
    const result = forecastCashFlow(
      input({
        today: '2024-02-27',
        horizonDays: 7,
        history: buildHistory([], '2024-02-27', undefined),
      }),
    );
    expect(result.buckets.map((bucket) => bucket.start)).toEqual([
      '2024-02-27',
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
      '2024-03-02',
      '2024-03-03',
      '2024-03-04',
      '2024-03-05',
    ]);
    expect(result.buckets.at(-1)?.end).toBe('2024-03-05');
  });

  it('uses daily buckets up to 30 days and weekly ones beyond', () => {
    expect(bucketBounds(7)).toHaveLength(8);
    expect(bucketBounds(60)).toEqual([
      [0, 6],
      [7, 13],
      [14, 20],
      [21, 27],
      [28, 34],
      [35, 41],
      [42, 48],
      [49, 55],
      [56, 60],
    ]);
  });
});
