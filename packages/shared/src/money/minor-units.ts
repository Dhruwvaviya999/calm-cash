import { CURRENCIES, type CurrencyCode } from '../constants/currencies';
import { MINOR_UNITS_MAX, MINOR_UNITS_MIN } from '../constants/money';
import type { MinorUnitsString } from '../types/common';

// Money is handled exclusively as `bigint` minor units in code and as canonical decimal strings
// in JSON. None of these helpers ever converts an amount to a floating-point `number`.

/** Canonical base-10 integer: no leading zeros, no plus sign, no `-0`. */
const CANONICAL_INTEGER_PATTERN = /^(?:0|-?[1-9]\d*)$/;

/** A sign plus the 19 digits of the largest BIGINT; longer input is rejected before parsing. */
const MAX_MINOR_UNITS_STRING_LENGTH = 20;

export function isMinorUnitsInRange(value: bigint): boolean {
  return value >= MINOR_UNITS_MIN && value <= MINOR_UNITS_MAX;
}

/** Parses a canonical minor-units string, returning `undefined` for malformed or out-of-range input. */
export function tryParseMinorUnits(value: string): bigint | undefined {
  if (value.length > MAX_MINOR_UNITS_STRING_LENGTH || !CANONICAL_INTEGER_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return isMinorUnitsInRange(parsed) ? parsed : undefined;
}

/** Parses a canonical minor-units string such as `"12550"`; throws a `RangeError` otherwise. */
export function parseMinorUnits(value: string): bigint {
  const parsed = tryParseMinorUnits(value);
  if (parsed === undefined) {
    throw new RangeError('Expected a canonical integer string within the BIGINT range.');
  }
  return parsed;
}

/** Serializes a minor-units amount for JSON transport; throws a `RangeError` outside BIGINT. */
export function serializeMinorUnits(value: bigint): MinorUnitsString {
  if (!isMinorUnitsInRange(value)) {
    throw new RangeError('Amount is outside the BIGINT range.');
  }
  return value.toString();
}

/**
 * Converts minor units into an exact major-unit decimal string using integer arithmetic only,
 * e.g. `12550n` INR → `"125.50"`, `-5n` INR → `"-0.05"`, `1500n` JPY → `"1500"`.
 */
export function minorUnitsToDecimalString(amount: bigint, currency: CurrencyCode): string {
  const digits = CURRENCIES[currency].minorUnitDigits;
  const sign = amount < 0n ? '-' : '';
  const absolute = (amount < 0n ? -amount : amount).toString();

  if (digits === 0) {
    return `${sign}${absolute}`;
  }

  const padded = absolute.padStart(digits + 1, '0');
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
