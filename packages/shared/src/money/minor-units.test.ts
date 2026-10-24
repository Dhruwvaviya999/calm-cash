import { describe, expect, it } from 'vitest';

import { MINOR_UNITS_MAX, MINOR_UNITS_MIN } from '../constants/money';
import {
  minorUnitsToDecimalString,
  parseMinorUnits,
  serializeMinorUnits,
  tryParseMinorUnits,
} from './minor-units';

describe('tryParseMinorUnits', () => {
  it('parses canonical integers exactly, beyond Number.MAX_SAFE_INTEGER', () => {
    expect(tryParseMinorUnits('12550')).toBe(12550n);
    expect(tryParseMinorUnits('-42')).toBe(-42n);
    expect(tryParseMinorUnits('0')).toBe(0n);
    // 2^53 + 1 cannot be represented by a JavaScript number.
    expect(tryParseMinorUnits('9007199254740993')).toBe(9007199254740993n);
  });

  it('accepts the full PostgreSQL BIGINT range and nothing beyond it', () => {
    expect(tryParseMinorUnits(MINOR_UNITS_MAX.toString())).toBe(MINOR_UNITS_MAX);
    expect(tryParseMinorUnits(MINOR_UNITS_MIN.toString())).toBe(MINOR_UNITS_MIN);
    expect(tryParseMinorUnits((MINOR_UNITS_MAX + 1n).toString())).toBeUndefined();
    expect(tryParseMinorUnits((MINOR_UNITS_MIN - 1n).toString())).toBeUndefined();
  });

  it.each(['', ' 1', '1 ', '+1', '-0', '007', '1.5', '1e3', '12,550', 'abc', '1'.repeat(100)])(
    'rejects non-canonical input %j',
    (input) => {
      expect(tryParseMinorUnits(input)).toBeUndefined();
    },
  );
});

describe('parseMinorUnits / serializeMinorUnits', () => {
  it('round-trips values exactly', () => {
    for (const value of [0n, 1n, -1n, 12550n, MINOR_UNITS_MAX, MINOR_UNITS_MIN]) {
      expect(parseMinorUnits(serializeMinorUnits(value))).toBe(value);
    }
  });

  it('throws a RangeError for invalid input', () => {
    expect(() => parseMinorUnits('12.50')).toThrow(RangeError);
    expect(() => serializeMinorUnits(MINOR_UNITS_MAX + 1n)).toThrow(RangeError);
  });
});

describe('minorUnitsToDecimalString', () => {
  it.each([
    [12550n, 'INR', '125.50'],
    [5n, 'INR', '0.05'],
    [-5n, 'INR', '-0.05'],
    [0n, 'USD', '0.00'],
    [1500n, 'JPY', '1500'],
    [-1500n, 'JPY', '-1500'],
    [1234n, 'KWD', '1.234'],
    [MINOR_UNITS_MAX, 'INR', '92233720368547758.07'],
  ] as const)('converts %s %s to %s', (amount, currency, expected) => {
    expect(minorUnitsToDecimalString(amount, currency)).toBe(expected);
  });

  it('avoids the floating-point error that number arithmetic would introduce', () => {
    // 0.1 + 0.2 !== 0.3 with numbers; integer minor units stay exact.
    expect(minorUnitsToDecimalString(10n + 20n, 'INR')).toBe('0.30');
  });
});
