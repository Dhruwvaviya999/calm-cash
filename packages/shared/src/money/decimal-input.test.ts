import { describe, expect, it } from 'vitest';

import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import {
  describeDecimalAmountError,
  formatDecimalAmount,
  parseDecimalAmount,
} from './decimal-input';

describe('parseDecimalAmount', () => {
  it('converts typed amounts to exact minor units per currency exponent', () => {
    expect(parseDecimalAmount('12500.50', 'INR')).toEqual({ ok: true, minorUnits: 1_250_050n });
    expect(parseDecimalAmount('12500.5', 'INR')).toEqual({ ok: true, minorUnits: 1_250_050n });
    expect(parseDecimalAmount('12500', 'INR')).toEqual({ ok: true, minorUnits: 1_250_000n });
    expect(parseDecimalAmount('1500', 'JPY')).toEqual({ ok: true, minorUnits: 1500n });
    expect(parseDecimalAmount('2.125', 'KWD')).toEqual({ ok: true, minorUnits: 2125n });
  });

  it('accepts digit grouping, including Indian lakh grouping', () => {
    expect(parseDecimalAmount('1,25,000.75', 'INR')).toEqual({ ok: true, minorUnits: 12_500_075n });
    expect(parseDecimalAmount(' 1 234 567 ', 'EUR')).toEqual({
      ok: true,
      minorUnits: 123_456_700n,
    });
  });

  it('distinguishes zero from a missing amount', () => {
    expect(parseDecimalAmount('0', 'INR')).toEqual({ ok: true, minorUnits: 0n });
    expect(parseDecimalAmount('0.00', 'INR')).toEqual({ ok: true, minorUnits: 0n });
    expect(parseDecimalAmount('   ', 'INR')).toEqual({ ok: false, error: 'empty' });
  });

  it('rejects extra decimal places instead of rounding', () => {
    expect(parseDecimalAmount('10.005', 'INR')).toEqual({ ok: false, error: 'precision' });
    expect(parseDecimalAmount('10.5', 'JPY')).toEqual({ ok: false, error: 'precision' });
    expect(parseDecimalAmount('1.0001', 'KWD')).toEqual({ ok: false, error: 'precision' });
  });

  it('rejects malformed input and floating-point notation', () => {
    for (const input of ['abc', '1e5', '1.2.3', '.5', '5.', '+5', '₹500', '0x10', 'NaN']) {
      expect(parseDecimalAmount(input, 'INR')).toEqual({ ok: false, error: 'format' });
    }
  });

  it('accepts negative amounts only when asked to', () => {
    expect(parseDecimalAmount('-250.00', 'INR')).toEqual({ ok: false, error: 'negative' });
    expect(parseDecimalAmount('-250.00', 'INR', { allowNegative: true })).toEqual({
      ok: true,
      minorUnits: -25_000n,
    });
    expect(parseDecimalAmount('-0', 'INR')).toEqual({ ok: true, minorUnits: 0n });
  });

  it('enforces the largest enterable amount at the exact boundary', () => {
    expect(parseDecimalAmount('9999999999999.99', 'INR')).toEqual({
      ok: true,
      minorUnits: MAX_ENTERED_AMOUNT_MINOR,
    });
    expect(parseDecimalAmount('10000000000000.00', 'INR')).toEqual({ ok: false, error: 'range' });
    expect(parseDecimalAmount('99999999999999999999999', 'INR')).toEqual({
      ok: false,
      error: 'range',
    });
  });

  it('round-trips through the editable format without loss', () => {
    for (const [minor, currency] of [
      [1_250_050n, 'INR'],
      [-5n, 'INR'],
      [1500n, 'JPY'],
      [2125n, 'KWD'],
      [MAX_ENTERED_AMOUNT_MINOR, 'INR'],
    ] as const) {
      const text = formatDecimalAmount(minor, currency);
      expect(parseDecimalAmount(text, currency, { allowNegative: true })).toEqual({
        ok: true,
        minorUnits: minor,
      });
    }
  });

  it('explains each failure in terms of the currency', () => {
    expect(describeDecimalAmountError('precision', 'INR')).toBe(
      'INR amounts have at most 2 decimal places.',
    );
    expect(describeDecimalAmountError('precision', 'JPY')).toBe(
      'JPY amounts have no decimal places.',
    );
  });
});
