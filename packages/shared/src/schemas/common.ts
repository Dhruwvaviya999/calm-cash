import { z } from 'zod';

import { CURRENCY_CODES } from '../constants/currencies';
import { TEXT_LIMITS } from '../constants/domain';
import { tryParseMinorUnits } from '../money/minor-units';

export const entityIdSchema = z.uuid();

/** `YYYY-MM-DD`; rejects impossible dates such as `2026-02-30`. */
export const isoDateSchema = z.iso.date();

/** UTC timestamp ending in `Z`, as produced by `Date.prototype.toISOString()`. */
export const isoDateTimeSchema = z.iso.datetime();

export const currencyCodeSchema = z.enum(CURRENCY_CODES);

function isValidTimeZone(value: string): boolean {
  try {
    return Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(TEXT_LIMITS.timezone)
  .refine(isValidTimeZone, { message: 'Must be a valid IANA time zone, e.g. "Asia/Kolkata".' });

/** Signed minor-units amount as a canonical integer string within the PostgreSQL BIGINT range. */
export const minorUnitsSchema = z
  .string()
  .refine((value) => tryParseMinorUnits(value) !== undefined, {
    message: 'Must be an integer amount in minor units within the supported range, e.g. "12550".',
  });

/** Strictly positive minor-units amount, e.g. a transaction amount or a budget limit. */
export const positiveMinorUnitsSchema = z.string().refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return parsed !== undefined && parsed > 0n;
  },
  { message: 'Must be a positive integer amount in minor units, e.g. "12550".' },
);

/** Single-line text: trimmed, required, no control characters. */
export function singleLineTextSchema(max: number, emptyMessage: string): z.ZodString {
  return z
    .string({ error: emptyMessage })
    .trim()
    .min(1, { error: emptyMessage })
    .max(max, { error: `Use at most ${max} characters.` })
    .regex(/^\P{Cc}*$/u, { error: 'Remove unsupported characters.' });
}

/** A query-string flag: `true` or `false`. */
export const booleanQuerySchema = z
  .enum(['true', 'false'], { error: 'Use true or false.' })
  .transform((value) => value === 'true');
