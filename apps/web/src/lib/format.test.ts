import { MINOR_UNITS_MAX } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyMagnitude,
  MINUS_SIGN,
  percentOf,
  subtractMinorUnits,
} from './format';

describe('formatMoney', () => {
  it('formats INR with Indian digit grouping and two decimals', () => {
    expect(formatMoney('245000', 'INR')).toBe('₹2,450.00');
    expect(formatMoney('20407600', 'INR')).toBe('₹2,04,076.00');
    expect(formatMoney('5', 'INR')).toBe('₹0.05');
  });

  it('uses a typographic minus sign for negative amounts', () => {
    expect(formatMoney('-1834900', 'INR')).toBe(`${MINUS_SIGN}₹18,349.00`);
    expect(formatMoneyMagnitude('-1834900', 'INR')).toBe('₹18,349.00');
  });

  it('respects each currency’s minor-unit digits', () => {
    expect(formatMoney('1500', 'JPY')).toBe('JP¥1,500');
    // ICU separates the currency code and the amount with a no-break space.
    expect(formatMoney('1234', 'KWD')).toBe('KWD 1.234');
  });

  it('stays exact beyond the range of JavaScript numbers', () => {
    // 2^63 − 1 paise: a float would round the last digits.
    expect(formatMoney(MINOR_UNITS_MAX, 'INR')).toBe('₹92,23,37,20,36,85,47,758.07');
  });

  it('rejects malformed amounts instead of guessing', () => {
    expect(() => formatMoney('12.50', 'INR')).toThrow(RangeError);
  });
});

describe('percentOf', () => {
  it('rounds half up with integer arithmetic', () => {
    expect(percentOf('845000', '1200000')).toBe(70);
    expect(percentOf('5882600', '11412000')).toBe(52);
    expect(percentOf('1', '200')).toBe(1);
  });

  it('allows values above 100% and guards against an empty total', () => {
    expect(percentOf('689900', '600000')).toBe(115);
    expect(percentOf('100', '0')).toBe(0);
  });
});

describe('subtractMinorUnits', () => {
  it('subtracts exactly and can go negative', () => {
    expect(subtractMinorUnits('600000', '689900')).toBe(-89900n);
    expect(subtractMinorUnits(MINOR_UNITS_MAX, 1n)).toBe(MINOR_UNITS_MAX - 1n);
  });
});

describe('formatDate', () => {
  it('formats instants in India Standard Time', () => {
    // 20:30 UTC on 24 Oct is already 25 Oct in IST (UTC+5:30).
    expect(formatDate('2026-10-24T20:30:00.000Z')).toBe('25 Oct');
    expect(formatDate('2026-10-24T06:20:00.000Z', 'fullDate')).toBe('24 October 2026');
  });

  it('keeps calendar dates on the same day', () => {
    expect(formatDate('2026-10-01', 'monthYear')).toBe('October 2026');
    expect(formatDate('2026-10-01')).toBe('1 Oct');
  });
});

describe('formatDateTime', () => {
  it('formats an instant in the requested time zone', () => {
    const instant = '2026-10-24T20:30:00.000Z';
    expect(formatDateTime(instant)).toBe('25 Oct 2026, 2:00 am');
    expect(formatDateTime(instant, 'America/New_York')).toBe('24 Oct 2026, 4:30 pm');
  });
});
