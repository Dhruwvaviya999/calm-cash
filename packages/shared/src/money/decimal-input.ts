import { CURRENCIES, type CurrencyCode } from '../constants/currencies';
import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import { minorUnitsToDecimalString } from './minor-units';

// Converts what a person types ("12,500.50") into exact minor units, honouring each currency's
// ISO 4217 exponent. Input with more decimal places than the currency allows is rejected, never
// rounded, and no step ever goes through a floating-point number.

export type DecimalAmountError = 'empty' | 'format' | 'precision' | 'negative' | 'range';

export type DecimalAmountResult =
  { ok: true; minorUnits: bigint } | { ok: false; error: DecimalAmountError };

export interface DecimalAmountOptions {
  /** Accept a leading minus sign (e.g. a bank overdraft). Defaults to `false`. */
  allowNegative?: boolean;
}

/** Digit-group separators people commonly type: commas and (non-breaking/thin) spaces. */
const GROUP_SEPARATORS = /[,\s\u00a0\u202f]/g;
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export function parseDecimalAmount(
  input: string,
  currency: CurrencyCode,
  { allowNegative = false }: DecimalAmountOptions = {},
): DecimalAmountResult {
  const compact = input.trim().replace(GROUP_SEPARATORS, '');
  if (compact === '') {
    return { ok: false, error: 'empty' };
  }

  const match = DECIMAL_PATTERN.exec(compact);
  if (match === null) {
    return { ok: false, error: 'format' };
  }
  const [, sign = '', whole = '0', fraction = ''] = match;
  const digits = CURRENCIES[currency].minorUnitDigits;
  if (fraction.length > digits) {
    return { ok: false, error: 'precision' };
  }

  const magnitude = BigInt(`${whole}${fraction.padEnd(digits, '0')}`);
  if (magnitude > MAX_ENTERED_AMOUNT_MINOR) {
    return { ok: false, error: 'range' };
  }
  if (sign === '-' && magnitude !== 0n && !allowNegative) {
    return { ok: false, error: 'negative' };
  }
  return { ok: true, minorUnits: sign === '-' ? -magnitude : magnitude };
}

/** A user-facing explanation of a `parseDecimalAmount` failure. */
export function describeDecimalAmountError(
  error: DecimalAmountError,
  currency: CurrencyCode,
): string {
  const digits = CURRENCIES[currency].minorUnitDigits;
  switch (error) {
    case 'empty':
      return 'Enter an amount (0 is fine).';
    case 'format':
      return 'Enter a number, such as 12500.50.';
    case 'precision':
      return digits === 0
        ? `${currency} amounts have no decimal places.`
        : `${currency} amounts have at most ${digits} decimal places.`;
    case 'negative':
      return 'Enter an amount of zero or more.';
    case 'range':
      return 'This amount is too large.';
  }
}

/** Minor units as an editable decimal string without grouping, e.g. `1250050n` INR → `"12500.50"`. */
export function formatDecimalAmount(minorUnits: bigint, currency: CurrencyCode): string {
  return minorUnitsToDecimalString(minorUnits, currency);
}
