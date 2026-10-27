import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/app-error';
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
import type { CashFlowSums, CategoryRow } from './dashboard.repository';

const NOW = new Date('2026-10-27T06:00:00.000Z');

function sums(income: bigint, expense: bigint, incomeCount = 1, expenseCount = 1): CashFlowSums {
  return { incomeMinor: income, expenseMinor: expense, incomeCount, expenseCount };
}

describe('periods and windows', () => {
  it('resolves presets against today in the user’s time zone', () => {
    // 27 Oct 06:00 UTC is still 26 Oct in Los Angeles.
    expect(resolveRange({ period: 'this-month' }, 'America/Los_Angeles', NOW)).toEqual({
      from: '2026-10-01',
      to: '2026-10-26',
    });
    expect(resolveRange({ period: 'this-month' }, 'Asia/Kolkata', NOW).to).toBe('2026-10-27');
  });

  it('refuses a custom period that ends in the future', () => {
    expect(() =>
      resolveRange({ period: 'custom', from: '2026-10-01', to: '2026-10-28' }, 'Asia/Kolkata', NOW),
    ).toThrow(AppError);
  });

  it('turns calendar days into a half-open window of instants', () => {
    expect(toWindow({ from: '2026-10-01', to: '2026-10-31' }, 'Asia/Kolkata')).toEqual({
      start: new Date('2026-09-30T18:30:00.000Z'),
      end: new Date('2026-10-31T18:30:00.000Z'),
    });
    // The New York day of the clock change has 25 hours; the window still ends at local midnight.
    expect(toWindow({ from: '2026-11-01', to: '2026-11-01' }, 'America/New_York')).toEqual({
      start: new Date('2026-11-01T04:00:00.000Z'),
      end: new Date('2026-11-02T05:00:00.000Z'),
    });
  });
});

describe('currencies', () => {
  it('puts the preferred currency first and defaults to it', () => {
    expect(orderCurrencies(['USD', 'INR', 'EUR'], 'INR')).toEqual(['INR', 'EUR', 'USD']);
    expect(chooseCurrency(undefined, ['USD', 'INR'], 'INR')).toBe('INR');
    expect(chooseCurrency(undefined, [], 'INR')).toBe('INR');
  });

  it('falls back to the user’s first currency when they hold no preferred-currency account', () => {
    expect(orderCurrencies(['USD', 'EUR'], 'INR')).toEqual(['EUR', 'USD']);
    expect(chooseCurrency(undefined, ['EUR', 'USD'], 'INR')).toBe('EUR');
    expect(chooseCurrency('USD', ['EUR'], 'INR')).toBe('USD');
  });
});

describe('cash-flow metrics', () => {
  it('derives net cash flow and the savings rate', () => {
    expect(toCashFlowTotals(sums(200_000n, 50_000n))).toEqual({
      incomeMinor: '200000',
      expenseMinor: '50000',
      netMinor: '150000',
      incomeCount: 1,
      expenseCount: 1,
    });
    expect(savingsRate(sums(200_000n, 50_000n))).toEqual({
      status: 'available',
      basisPoints: '7500',
    });
    expect(savingsRate(sums(200_000n, 300_000n))).toEqual({
      status: 'available',
      basisPoints: '-5000',
    });
    expect(savingsRate(sums(0n, 300_000n, 0))).toEqual({
      status: 'unavailable',
      reason: 'no_income',
    });
  });

  it('compares with the previous period without dividing by zero', () => {
    const range = { from: '2026-09-01', to: '2026-09-27' };
    expect(compare(sums(100n, 50n), sums(0n, 0n, 0, 0), range)).toEqual({
      status: 'unavailable',
      ...range,
      reason: 'no_previous_activity',
    });
    // Spending only before: income change exists in money, not as a percentage.
    expect(compare(sums(100n, 50n), sums(0n, 25n, 0, 1), range)).toEqual({
      status: 'available',
      ...range,
      income: {
        previousMinor: '0',
        changeMinor: '100',
        changePercent: { status: 'unavailable', reason: 'no_previous_value' },
      },
      expense: {
        previousMinor: '25',
        changeMinor: '25',
        changePercent: { status: 'available', basisPoints: '10000' },
      },
      net: { previousMinor: '-25', changeMinor: '75' },
    });
  });
});

describe('fillTrend', () => {
  it('fills days without activity with real zeros and keeps the sums exact', () => {
    const buckets = fillTrend({ from: '2026-10-01', to: '2026-10-03' }, 'day', [
      { bucket: '2026-10-02', incomeMinor: 999_999_999_999_999n, expenseMinor: 1n },
    ]);
    expect(buckets).toEqual([
      {
        start: '2026-10-01',
        end: '2026-10-01',
        partial: false,
        incomeMinor: '0',
        expenseMinor: '0',
        netMinor: '0',
      },
      {
        start: '2026-10-02',
        end: '2026-10-02',
        partial: false,
        incomeMinor: '999999999999999',
        expenseMinor: '1',
        netMinor: '999999999999998',
      },
      {
        start: '2026-10-03',
        end: '2026-10-03',
        partial: false,
        incomeMinor: '0',
        expenseMinor: '0',
        netMinor: '0',
      },
    ]);
  });
});

describe('rankCategories', () => {
  const row = (name: string | null, total: bigint, count = 1): CategoryRow => ({
    categoryId:
      name === null ? null : `0193a000-0000-7000-8000-${name.padStart(12, '0').slice(-12)}`,
    name,
    archived: false,
    totalMinor: total,
    count,
  });

  it('ranks by amount, breaks ties by name, and lets uncategorised spending compete', () => {
    const { entries, totalMinor, count } = rankCategories([
      row('b', 100n),
      row(null, 300n, 2),
      row('a', 100n),
    ]);
    expect(totalMinor).toBe(500n);
    expect(count).toBe(4);
    expect(entries.map((entry) => (entry.kind === 'category' ? entry.name : entry.kind))).toEqual([
      'uncategorized',
      'a',
      'b',
    ]);
    expect(entries.map((entry) => entry.shareBasisPoints)).toEqual(['6000', '2000', '2000']);
  });

  it('adds everything past the limit into an exact "Other"', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name, index) =>
      row(name, BigInt(800 - index * 100)),
    );
    const { entries } = rankCategories(rows, 6);
    expect(entries).toHaveLength(7);
    expect(entries.at(-1)).toEqual({
      kind: 'other',
      categoryCount: 2,
      amountMinor: '300', // 200 + 100
      transactionCount: 2,
      shareBasisPoints: '833', // 300 ÷ 3,600
    });
  });

  it('shows a single leftover category by name instead of hiding it in "Other"', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => row(name, 10n));
    expect(rankCategories(rows, 6).entries.every((entry) => entry.kind === 'category')).toBe(true);
  });
});
