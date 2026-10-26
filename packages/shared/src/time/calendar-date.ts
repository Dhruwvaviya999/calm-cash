import type { IsoDateString } from '../types/common';

/**
 * The calendar date of an instant in an IANA time zone, as `YYYY-MM-DD`. "Today" for a user is
 * `calendarDateInTimeZone(new Date(), user.timezone)`; it can differ from the UTC date.
 */
export function calendarDateInTimeZone(instant: Date, timeZone: string): IsoDateString {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
