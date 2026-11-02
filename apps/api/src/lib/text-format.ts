import {
  CURRENCIES,
  divideRounded,
  minorUnitsToDecimalString,
  type CurrencyCode,
  type IsoDateString,
} from '@calmcash/shared';

// Plain-text wording of amounts, dates, and ratios for server-written text (notifications,
// e-mails, insights, assistant answers). Amounts are exact: minor units → decimal string → Intl,
// never floating point.

/** Same conventions as the web app's default display (Indian digit grouping). */
const LOCALE = 'en-IN';
const DECIMAL_LITERAL = /^-?\d+(?:\.\d+)?$/;
const MINUS_SIGN = '−';

function isDecimalLiteral(value: string): value is `${number}` {
  return DECIMAL_LITERAL.test(value);
}

const moneyFormatters = new Map<CurrencyCode, Intl.NumberFormat>();

/** `"245000"` INR → `"₹2,450.00"`; negatives get a typographic minus. */
export function formatMoney(amount: bigint | string, currency: CurrencyCode): string {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount);
  let formatter = moneyFormatters.get(currency);
  if (formatter === undefined) {
    const digits = CURRENCIES[currency].minorUnitDigits;
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFormatters.set(currency, formatter);
  }
  const decimal = minorUnitsToDecimalString(value < 0n ? -value : value, currency);
  if (!isDecimalLiteral(decimal)) {
    throw new RangeError('Amount could not be converted to a decimal string.');
  }
  const magnitude = formatter.format(decimal);
  return value < 0n ? `${MINUS_SIGN}${magnitude}` : magnitude;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar date as words, e.g. `"Fri, 31 Oct 2026"` (calendar dates have no time zone). */
export function formatDate(date: IsoDateString): string {
  return dateFormatter.format(new Date(`${date}T12:00:00.000Z`));
}

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatRange(from: IsoDateString, to: IsoDateString): string {
  const format = (date: IsoDateString): string =>
    shortDateFormatter.format(new Date(`${date}T12:00:00.000Z`));
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `"2026-10"` → `"October 2026"`. */
export function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-15T12:00:00.000Z`));
}

/** Basis points as a percentage with at most one decimal: 8000 → `"80%"`, 3654 → `"36.5%"`. */
export function formatBasisPoints(basisPoints: bigint): string {
  const tenths = divideRounded(basisPoints, 10n);
  const sign = tenths < 0n ? MINUS_SIGN : '';
  const absolute = tenths < 0n ? -tenths : tenths;
  const whole = absolute / 10n;
  const fraction = absolute % 10n;
  return `${sign}${whole.toString()}${fraction === 0n ? '' : `.${fraction.toString()}`}%`;
}

/** Shortens text to `max` characters (whole text when it fits), never cutting mid-character. */
export function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join('')}…`;
}
