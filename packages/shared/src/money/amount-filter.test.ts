import { describe, expect, it } from 'vitest';

import { amountFilterToMinorUnits, compareAmountFilters } from './amount-filter';

describe('amountFilterToMinorUnits', () => {
  it('converts exactly when the currency has enough decimal places', () => {
    expect(amountFilterToMinorUnits('500', 'INR', 'lower')).toBe(50_000n);
    expect(amountFilterToMinorUnits('99.99', 'INR', 'upper')).toBe(9_999n);
    expect(amountFilterToMinorUnits('2.125', 'KWD', 'lower')).toBe(2_125n);
    expect(amountFilterToMinorUnits('1500', 'JPY', 'upper')).toBe(1_500n);
  });

  it('rounds inward for currencies with fewer decimal places, never outward', () => {
    // At least ¥10.5 means ¥11 or more; at most ¥10.5 means ¥10 or less.
    expect(amountFilterToMinorUnits('10.5', 'JPY', 'lower')).toBe(11n);
    expect(amountFilterToMinorUnits('10.5', 'JPY', 'upper')).toBe(10n);
    expect(amountFilterToMinorUnits('0.005', 'INR', 'lower')).toBe(1n);
    expect(amountFilterToMinorUnits('0.005', 'INR', 'upper')).toBe(0n);
  });

  it('stays exact for the largest accepted values', () => {
    expect(amountFilterToMinorUnits('999999999999999.999', 'KWD', 'upper')).toBe(
      999_999_999_999_999_999n,
    );
  });

  it('rejects anything that is not a plain non-negative decimal', () => {
    for (const value of ['-1', '1e3', '1.2345', '', ' 5', '1,000']) {
      expect(() => amountFilterToMinorUnits(value, 'INR', 'lower')).toThrow(RangeError);
    }
  });
});

describe('compareAmountFilters', () => {
  it('compares decimal strings by value', () => {
    expect(compareAmountFilters('10', '9.999')).toBe(1);
    expect(compareAmountFilters('10.0', '10')).toBe(0);
    expect(compareAmountFilters('0.1', '0.25')).toBe(-1);
  });
});
