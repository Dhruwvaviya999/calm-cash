import {
  CURRENCIES,
  minorUnitsToDecimalString,
  parseMinorUnits,
  type CurrencyCode,
  type IsoDateTimeString,
  type MinorUnitsString,
} from '@calmcash/shared';

// Presentation formatting. Money stays exact: minor units are converted to a decimal string with
// integer arithmetic and passed to Intl as a string, so no value is ever a floating-point number.

/** Default display conventions (India); signed-in views pass the user's own time zone. */
export const DISPLAY_LOCALE = 'en-IN';
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

/** Unicode minus sign: typographically aligned with "+", unlike the hyphen-minus. */
export const MINUS_SIGN = '−';

const DECIMAL_LITERAL = /^-?\d+(?:\.\d+)?$/;

function isDecimalLiteral(value: string): value is `${number}` {
  return DECIMAL_LITERAL.test(value);
}

function toBigInt(amount: MinorUnitsString | bigint): bigint {
  return typeof amount === 'bigint' ? amount : parseMinorUnits(amount);
}

const currencyFormatters = new Map<CurrencyCode, Intl.NumberFormat>();

function getCurrencyFormatter(currency: CurrencyCode): Intl.NumberFormat {
  let formatter = currencyFormatters.get(currency);
  if (formatter === undefined) {
    const digits = CURRENCIES[currency].minorUnitDigits;
    formatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter;
}

/** Formats the absolute value, e.g. `"245000"` INR → `"₹2,450.00"` (Indian digit grouping). */
export function formatMoneyMagnitude(
  amount: MinorUnitsString | bigint,
  currency: CurrencyCode,
): string {
  const value = toBigInt(amount);
  const decimal = minorUnitsToDecimalString(value < 0n ? -value : value, currency);
  if (!isDecimalLiteral(decimal)) {
    throw new RangeError('Amount could not be converted to a decimal string.');
  }
  return getCurrencyFormatter(currency).format(decimal);
}

/** Locale-aware parts of the absolute value, for typographic treatment of symbol and fraction. */
export function formatMoneyMagnitudeToParts(
  amount: MinorUnitsString | bigint,
  currency: CurrencyCode,
): Intl.NumberFormatPart[] {
  const value = toBigInt(amount);
  const decimal = minorUnitsToDecimalString(value < 0n ? -value : value, currency);
  if (!isDecimalLiteral(decimal)) {
    throw new RangeError('Amount could not be converted to a decimal string.');
  }
  return getCurrencyFormatter(currency).formatToParts(decimal);
}

/** Formats a signed amount with a typographic minus for negatives, e.g. `"−₹2,450.00"`. */
export function formatMoney(amount: MinorUnitsString | bigint, currency: CurrencyCode): string {
  const magnitude = formatMoneyMagnitude(amount, currency);
  return toBigInt(amount) < 0n ? `${MINUS_SIGN}${magnitude}` : magnitude;
}

/** Exact `minuend − subtrahend` in minor units, e.g. a budget limit minus the amount spent. */
export function subtractMinorUnits(
  minuend: MinorUnitsString | bigint,
  subtrahend: MinorUnitsString | bigint,
): bigint {
  return toBigInt(minuend) - toBigInt(subtrahend);
}

/**
 * Whole-number percentage of `part` in `total` using integer arithmetic (rounded half up).
 * Returns 0 when `total` is not positive.
 */
export function percentOf(
  part: MinorUnitsString | bigint,
  total: MinorUnitsString | bigint,
): number {
  const numerator = toBigInt(part);
  const denominator = toBigInt(total);
  if (denominator <= 0n) {
    return 0;
  }
  return Number((numerator * 200n + denominator) / (denominator * 2n));
}

const dateFormatters = {
  dayMonth: new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: DISPLAY_TIME_ZONE,
  }),
  fullDate: new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  }),
  monthYear: new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  }),
} as const;

export type DateStyle = keyof typeof dateFormatters;

/**
 * Formats an ISO timestamp (`IsoDateTimeString`) or calendar date (`IsoDateString`, both strings)
 * in the display time zone, e.g. `"24 Oct"`.
 */
export function formatDate(value: IsoDateTimeString, style: DateStyle = 'dayMonth'): string {
  // Calendar dates are anchored at noon UTC so every time zone shows the same day.
  const instant = value.length === 10 ? `${value}T12:00:00.000Z` : value;
  return dateFormatters[style].format(new Date(instant));
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats an instant as date and time in an IANA time zone (the user's preference when known),
 * e.g. `"26 Oct 2026, 10:45 am"`.
 */
export function formatDateTime(
  value: IsoDateTimeString,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  let formatter = dateTimeFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(value));
}
