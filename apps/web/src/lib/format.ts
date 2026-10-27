import {
  CURRENCIES,
  divideRounded,
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

const DATE_STYLES = {
  dayMonth: { day: 'numeric', month: 'short' },
  dayMonthYear: { day: 'numeric', month: 'short', year: 'numeric' },
  fullDate: { day: 'numeric', month: 'long', year: 'numeric' },
  monthYear: { month: 'long', year: 'numeric' },
  monthShortYear: { month: 'short', year: '2-digit' },
} as const satisfies Readonly<Record<string, Intl.DateTimeFormatOptions>>;

export type DateStyle = keyof typeof DATE_STYLES;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats an ISO timestamp (`IsoDateTimeString`) or calendar date (`IsoDateString`, both strings)
 * in a time zone (the user's preference when known), e.g. `"24 Oct"`.
 */
export function formatDate(
  value: IsoDateTimeString,
  style: DateStyle = 'dayMonth',
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  // Calendar dates are shown as written, whatever the time zone.
  const calendarDate = value.length === 10;
  const zone = calendarDate ? 'UTC' : timeZone;
  const key = `${style}|${zone}`;
  let formatter = dateFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...DATE_STYLES[style], timeZone: zone });
    dateFormatters.set(key, formatter);
  }
  return formatter.format(new Date(calendarDate ? `${value}T12:00:00.000Z` : value));
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

const percentFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A ratio in basis points (canonical integer string) as a percentage with one decimal place,
 * e.g. `"9496"` → `"95.0%"`, `"-25000"` → `"−250.0%"`. Rounding happens only here, for display.
 */
export function formatBasisPoints(basisPoints: string, { signed = false } = {}): string {
  // Validated by the response schema; ratios are not money, so they may exceed BIGINT.
  if (!/^(?:0|-?[1-9]\d*)$/.test(basisPoints)) {
    throw new RangeError('Expected a whole number of basis points.');
  }
  const tenths = divideRounded(BigInt(basisPoints), 10n);
  const magnitude = tenths < 0n ? -tenths : tenths;
  const decimal = `${(magnitude / 10n).toString()}.${(magnitude % 10n).toString()}`;
  if (!isDecimalLiteral(decimal)) {
    throw new RangeError('Percentage could not be formatted.');
  }
  const sign = tenths < 0n ? MINUS_SIGN : signed && tenths > 0n ? '+' : '';
  return `${sign}${percentFormatter.format(decimal)}%`;
}

const compactFormatters = new Map<CurrencyCode, Intl.NumberFormat>();

/** Short money label for chart axes, e.g. `"₹1.2L"` or `"$4.5K"`. Exact amounts live elsewhere. */
export function formatCompactMoney(
  amount: MinorUnitsString | bigint,
  currency: CurrencyCode,
): string {
  let formatter = compactFormatters.get(currency);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    compactFormatters.set(currency, formatter);
  }
  const value = toBigInt(amount);
  const decimal = minorUnitsToDecimalString(value < 0n ? -value : value, currency);
  if (!isDecimalLiteral(decimal)) {
    throw new RangeError('Amount could not be converted to a decimal string.');
  }
  return `${value < 0n ? MINUS_SIGN : ''}${formatter.format(decimal)}`;
}
