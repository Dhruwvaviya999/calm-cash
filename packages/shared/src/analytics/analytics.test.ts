import { describe, expect, it } from 'vitest';

import { dashboardQuerySchema, ratioDtoSchema } from '../schemas/dashboard';
import {
  addMonthsToIsoDate,
  bucketKey,
  daysBetween,
  presetRange,
  previousRange,
  trendBuckets,
  trendGranularity,
} from './periods';
import {
  divideRounded,
  percentChangeBasisPoints,
  savingsRateBasisPoints,
  shareBasisPoints,
} from './ratios';

describe('ratios', () => {
  it('rounds halves away from zero, in both directions', () => {
    expect(divideRounded(5n, 2n)).toBe(3n);
    expect(divideRounded(-5n, 2n)).toBe(-3n);
    expect(divideRounded(4n, 3n)).toBe(1n);
    expect(divideRounded(-4n, 3n)).toBe(-1n);
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError);
  });

  it('calculates the savings rate from income and expenses', () => {
    // Earned 85,000.00, spent 29,543.70 → kept 65.24…%.
    expect(savingsRateBasisPoints(8_500_000n, 2_954_370n)).toBe(6524n);
    expect(savingsRateBasisPoints(100_000n, 0n)).toBe(10_000n);
    expect(savingsRateBasisPoints(100_000n, 100_000n)).toBe(0n);
  });

  it('keeps a negative savings rate negative instead of clamping it', () => {
    // Earned 1,000.00, spent 3,500.00 → −250%.
    expect(savingsRateBasisPoints(100_000n, 350_000n)).toBe(-25_000n);
  });

  it('has no savings rate without income, rather than dividing by zero', () => {
    expect(savingsRateBasisPoints(0n, 50_000n)).toBeUndefined();
    expect(savingsRateBasisPoints(0n, 0n)).toBeUndefined();
  });

  it('stays exact for amounts far beyond safe JavaScript integers', () => {
    expect(savingsRateBasisPoints(1n, 999_999_999_999_999n)).toBe(-9_999_999_999_999_980_000n);
  });

  it('only reports a percentage change from a positive previous value', () => {
    expect(percentChangeBasisPoints(150n, 100n)).toBe(5000n);
    expect(percentChangeBasisPoints(50n, 100n)).toBe(-5000n);
    expect(percentChangeBasisPoints(100n, 0n)).toBeUndefined();
    expect(percentChangeBasisPoints(0n, 0n)).toBeUndefined();
  });

  it('computes shares of a total', () => {
    expect(shareBasisPoints(1n, 3n)).toBe(3333n);
    expect(shareBasisPoints(2n, 3n)).toBe(6667n);
    expect(shareBasisPoints(5n, 0n)).toBe(0n);
  });
});

describe('dashboard periods', () => {
  it('resolves presets from the user’s today', () => {
    expect(presetRange('this-month', '2026-10-27')).toEqual({
      from: '2026-10-01',
      to: '2026-10-27',
    });
    expect(presetRange('last-month', '2026-10-27')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(presetRange('last-month', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(presetRange('last-month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('last-3-months', '2026-10-27')).toEqual({
      from: '2026-08-01',
      to: '2026-10-27',
    });
    expect(presetRange('last-6-months', '2026-02-10')).toEqual({
      from: '2025-09-01',
      to: '2026-02-10',
    });
    expect(presetRange('this-year', '2026-10-27')).toEqual({
      from: '2026-01-01',
      to: '2026-10-27',
    });
  });

  it('compares a partial month with the same days of the previous month', () => {
    expect(previousRange({ from: '2026-10-01', to: '2026-10-27' }, 'this-month')).toEqual({
      from: '2026-09-01',
      to: '2026-09-27',
    });
    // 30 March has no counterpart in February: the comparison ends on 28 February.
    expect(previousRange({ from: '2026-03-01', to: '2026-03-30' }, 'this-month')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('compares whole months with whole months', () => {
    expect(previousRange({ from: '2026-09-01', to: '2026-09-30' }, 'last-month')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(previousRange({ from: '2026-02-01', to: '2026-02-28' }, 'last-month')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('shifts multi-month presets by their length and custom ranges by their days', () => {
    expect(previousRange({ from: '2026-08-01', to: '2026-10-27' }, 'last-3-months')).toEqual({
      from: '2026-05-01',
      to: '2026-07-27',
    });
    expect(previousRange({ from: '2026-01-01', to: '2026-10-27' }, 'this-year')).toEqual({
      from: '2025-01-01',
      to: '2025-10-27',
    });
    expect(previousRange({ from: '2026-10-10', to: '2026-10-19' }, 'custom')).toEqual({
      from: '2026-09-30',
      to: '2026-10-09',
    });
  });

  it('does calendar arithmetic across month and leap-year ends', () => {
    expect(addMonthsToIsoDate('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsToIsoDate('2026-01-31', -2)).toBe('2025-11-30');
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
});

describe('trend buckets', () => {
  it('chooses days for a month, weeks for a quarter, months for a year', () => {
    expect(trendGranularity({ from: '2026-10-01', to: '2026-10-31' })).toBe('day');
    expect(trendGranularity({ from: '2026-08-01', to: '2026-10-27' })).toBe('week');
    expect(trendGranularity({ from: '2026-01-01', to: '2026-10-27' })).toBe('month');
    expect(trendGranularity({ from: '2020-01-01', to: '2026-10-27' })).toBe('year');
  });

  it('starts weeks on Monday, as PostgreSQL does', () => {
    expect(bucketKey('2026-10-27', 'week')).toBe('2026-10-26'); // a Tuesday
    expect(bucketKey('2026-10-25', 'week')).toBe('2026-10-19'); // a Sunday
    expect(bucketKey('2026-10-27', 'month')).toBe('2026-10-01');
  });

  it('lists every bucket, clipped to the range and marked when partial', () => {
    expect(trendBuckets({ from: '2026-08-15', to: '2026-10-27' }, 'month')).toEqual([
      { key: '2026-08-01', start: '2026-08-15', end: '2026-08-31', partial: true },
      { key: '2026-09-01', start: '2026-09-01', end: '2026-09-30', partial: false },
      { key: '2026-10-01', start: '2026-10-01', end: '2026-10-27', partial: true },
    ]);
    const days = trendBuckets({ from: '2026-10-01', to: '2026-10-27' }, 'day');
    expect(days).toHaveLength(27);
    expect(days.every((bucket) => !bucket.partial)).toBe(true);
    const weeks = trendBuckets({ from: '2026-10-01', to: '2026-10-27' }, 'week');
    expect(weeks[0]).toEqual({
      key: '2026-09-28',
      start: '2026-10-01',
      end: '2026-10-04',
      partial: true,
    });
    expect(weeks.at(-1)).toEqual({
      key: '2026-10-26',
      start: '2026-10-26',
      end: '2026-10-27',
      partial: true,
    });
  });
});

describe('dashboardQuerySchema', () => {
  it('defaults to this month and accepts presets without dates', () => {
    expect(dashboardQuerySchema.parse({})).toEqual({ period: 'this-month' });
    expect(dashboardQuerySchema.parse({ period: 'last-month', currency: 'USD' })).toEqual({
      period: 'last-month',
      currency: 'USD',
    });
  });

  it('requires both dates, in order, for a custom period only', () => {
    expect(
      dashboardQuerySchema.safeParse({ period: 'custom', from: '2026-10-01', to: '2026-10-10' })
        .success,
    ).toBe(true);
    for (const query of [
      { period: 'custom', from: '2026-10-01' },
      { period: 'custom', from: '2026-10-10', to: '2026-10-01' },
      { period: 'this-month', from: '2026-10-01' },
      { period: 'custom', from: '2026-02-30', to: '2026-03-01' },
      { period: 'forever' },
      { currency: 'XYZ' },
      { currency: 'inr' },
      { userId: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70' },
    ]) {
      expect(dashboardQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});

describe('ratioDtoSchema', () => {
  it('carries ratios beyond the BIGINT range exactly', () => {
    const huge = (savingsRateBasisPoints(1n, 999_999_999_999_999n) ?? 0n) * 1000n;
    expect(
      ratioDtoSchema.safeParse({ status: 'available', basisPoints: huge.toString() }).success,
    ).toBe(true);
    expect(ratioDtoSchema.safeParse({ status: 'available', basisPoints: '-0' }).success).toBe(
      false,
    );
  });

  it('distinguishes an unavailable ratio from a zero one', () => {
    expect(ratioDtoSchema.parse({ status: 'available', basisPoints: '0' })).toEqual({
      status: 'available',
      basisPoints: '0',
    });
    expect(ratioDtoSchema.safeParse({ status: 'unavailable', reason: 'no_income' }).success).toBe(
      true,
    );
    expect(ratioDtoSchema.safeParse({ status: 'available', basisPoints: 12.5 }).success).toBe(
      false,
    );
    expect(ratioDtoSchema.safeParse({ status: 'available' }).success).toBe(false);
  });
});
