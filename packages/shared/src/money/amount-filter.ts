import { CURRENCIES, type CurrencyCode } from '../constants/currencies';

// Amount filters are typed in major units ("500", "99.99") and apply to every currency at once.
// Each bound is converted per currency with integer arithmetic: a lower bound rounds up and an
// upper bound rounds down to the currency's precision, so `≥ 10.5` matches ¥11 but not ¥10.

/** Non-negative decimal with at most three decimal places (the finest supported currency). */
export const AMOUNT_FILTER_PATTERN = /^\d{1,15}(?:\.\d{1,3})?$/;

const FILTER_SCALE_DIGITS = 3;

export type AmountBound = 'lower' | 'upper';

/** The value at a scale of three decimal places, e.g. `"12.5"` → `12500n`. */
function toThousandths(value: string): bigint {
  if (!AMOUNT_FILTER_PATTERN.test(value)) {
    throw new RangeError('Expected a non-negative decimal amount with at most 3 decimal places.');
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(FILTER_SCALE_DIGITS, '0')}`);
}

/** Converts a filter amount to inclusive minor units of `currency`. */
export function amountFilterToMinorUnits(
  value: string,
  currency: CurrencyCode,
  bound: AmountBound,
): bigint {
  const thousandths = toThousandths(value);
  const factor = 10n ** BigInt(FILTER_SCALE_DIGITS - CURRENCIES[currency].minorUnitDigits);
  return bound === 'lower' ? (thousandths + factor - 1n) / factor : thousandths / factor;
}

/** Compares two filter amounts exactly; negative when `a < b`. */
export function compareAmountFilters(a: string, b: string): number {
  const difference = toThousandths(a) - toThousandths(b);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
