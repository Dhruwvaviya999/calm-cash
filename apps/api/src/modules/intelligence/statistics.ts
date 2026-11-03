import {
  CURRENCIES,
  divideRounded,
  INTELLIGENCE_RULES,
  serializeMinorUnits,
  type CurrencyCode,
  type MonthlyStatisticsDto,
  type SpendingTrend,
} from '@calmcash/shared';

import { changeBp, median, percentile } from '../insights/patterns';

// Exact statistics over `bigint` minor units. Means round to the nearest minor unit (halves away
// from zero, `divideRounded`); medians and quartiles reuse the insights module's definitions, so
// "typical" means the same thing on every page. Nothing here reads the clock or the database.

export { changeBp, median, percentile };

/** Days per year in the calendar's long-run average (365.25), as an exact fraction: 1461 / 4. */
const QUARTER_DAYS_PER_YEAR = 1_461n;

export function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** Mean, rounded to the nearest minor unit; 0 for no values. */
export function mean(values: readonly bigint[]): bigint {
  return values.length === 0 ? 0n : divideRounded(sum(values), BigInt(values.length));
}

export function lowest(values: readonly bigint[]): bigint {
  return values.reduce((min, value) => (value < min ? value : min), values[0] ?? 0n);
}

export function highest(values: readonly bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), values[0] ?? 0n);
}

/** The lower quartile (25th percentile, nearest-rank), as the insights module defines it. */
export function lowerQuartile(values: readonly bigint[]): bigint {
  return percentile(values, 0.25);
}

/**
 * A monthly amount spread over `days`, at the long-run average month length (365.25 ÷ 12 days):
 * `monthly × days × 12 ÷ 365.25` = `monthly × days × 48 ÷ 1461`, rounded to the minor unit.
 */
export function prorate(monthlyMinor: bigint, days: number): bigint {
  if (days <= 0) return 0n;
  return divideRounded(monthlyMinor * 48n * BigInt(days), QUARTER_DAYS_PER_YEAR);
}

export interface MonthAmount {
  month: string;
  amountMinor: bigint;
  count: number;
}

export function monthlyStatistics(months: readonly MonthAmount[]): MonthlyStatisticsDto {
  const amounts = months.map((entry) => entry.amountMinor);
  return {
    months: months.map((entry) => ({
      month: entry.month,
      amountMinor: serializeMinorUnits(entry.amountMinor),
      count: entry.count,
    })),
    averageMinor: serializeMinorUnits(mean(amounts)),
    medianMinor: serializeMinorUnits(median(amounts)),
    lowestMinor: serializeMinorUnits(lowest(amounts)),
    highestMinor: serializeMinorUnits(highest(amounts)),
  };
}

/**
 * Rising or falling when the median of the newest three months differs from the median of the
 * three before by at least 20 %; `unknown` with fewer than six months or nothing in the earlier
 * half (a single large purchase moves a median far less than a mean).
 */
export function trendOf(amounts: readonly bigint[]): SpendingTrend {
  if (amounts.length < 6) return 'unknown';
  const earlier = median(amounts.slice(-6, -3));
  const later = median(amounts.slice(-3));
  const change = changeBp(earlier, later);
  if (change === undefined) return 'unknown';
  if (change >= INTELLIGENCE_RULES.trendChangeBp) return 'rising';
  if (change <= -INTELLIGENCE_RULES.trendChangeBp) return 'falling';
  return 'stable';
}

/**
 * Rounds a suggested limit up to a readable step: 100 major units from 1,000, 10 from 100,
 * otherwise 1 (₹4,512.40 → ₹4,600; ₹312 → ₹320; ¥87 → ¥87).
 */
export function roundUpToStep(amountMinor: bigint, currency: CurrencyCode): bigint {
  if (amountMinor <= 0n) return 0n;
  const unit = 10n ** BigInt(CURRENCIES[currency].minorUnitDigits);
  const step =
    amountMinor >= 1_000n * unit ? 100n * unit : amountMinor >= 100n * unit ? 10n * unit : unit;
  return ((amountMinor + step - 1n) / step) * step;
}

/** Whole months needed to cover `remaining` at `perMonth`, rounded up. */
export function monthsToCover(remainingMinor: bigint, perMonthMinor: bigint): number | undefined {
  if (perMonthMinor <= 0n) return undefined;
  if (remainingMinor <= 0n) return 0;
  return Number((remainingMinor + perMonthMinor - 1n) / perMonthMinor);
}

/** `amount × basisPoints ÷ 10 000`, rounded to the minor unit. */
export function applyBasisPoints(amountMinor: bigint, basisPoints: number | bigint): bigint {
  return divideRounded(amountMinor * BigInt(basisPoints), 10_000n);
}

/** A whole-number ratio as text with one decimal, e.g. 34 tenths → `"3.4"`. */
export function tenthsText(numerator: bigint, denominator: bigint): string | undefined {
  if (denominator <= 0n) return undefined;
  const tenths = divideRounded(numerator * 10n, denominator);
  const sign = tenths < 0n ? '−' : '';
  const absolute = tenths < 0n ? -tenths : tenths;
  return `${sign}${(absolute / 10n).toString()}.${(absolute % 10n).toString()}`;
}
