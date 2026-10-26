import type { IsoDateString } from '../types/common';

// Conversions between instants and wall-clock time in an IANA time zone, shared by the web app
// (forms show and accept the user's local time) and the API (calendar-date filters). They follow
// the "compatible" rule used by PostgreSQL and Temporal: a wall-clock time that occurs twice (when
// clocks go back) resolves to the earlier instant, and one skipped by a daylight-saving jump
// resolves to the same distance after the jump.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

/** Wall-clock time as `HH:mm` (24-hour). */
export type WallClockTime = string;

export interface ZonedDateTime {
  date: IsoDateString;
  time: WallClockTime;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** UTC milliseconds of a wall-clock reading, read as if it were UTC. */
function utcFromFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** The wall-clock reading of `instantMs` in `timeZone`, as UTC milliseconds (seconds precision). */
function wallClockMs(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return utcFromFields(
    value('year'),
    value('month'),
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
}

/** The whole-second wall-clock reading of an instant, compared against whole-second values. */
function wallClockAt(instantMs: number, timeZone: string): number {
  return wallClockMs(Math.floor(instantMs / 1000) * 1000, timeZone);
}

/** Offset of `timeZone` from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(instantMs: number, timeZone: string): number {
  const wholeSeconds = Math.floor(instantMs / 1000) * 1000;
  return wallClockMs(wholeSeconds, timeZone) - wholeSeconds;
}

function parseDate(date: IsoDateString): [number, number, number] {
  const match = DATE_PATTERN.exec(date);
  if (match === null) {
    throw new RangeError('Expected a calendar date as YYYY-MM-DD.');
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseTime(time: WallClockTime): [number, number] {
  const match = TIME_PATTERN.exec(time);
  if (match === null) {
    throw new RangeError('Expected a time as HH:mm.');
  }
  return [Number(match[1]), Number(match[2])];
}

/** `HH:mm`, 00:00–23:59. */
export function isWallClockTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** The instant at which the wall clock in `timeZone` shows `date` and `time`. */
export function zonedDateTimeToInstant(
  date: IsoDateString,
  time: WallClockTime,
  timeZone: string,
): Date {
  const [year, month, day] = parseDate(date);
  const [hour, minute] = parseTime(time);
  const wall = utcFromFields(year, month, day, hour, minute);

  const offsetBefore = offsetMs(wall - DAY_MS, timeZone);
  const offsetAfter = offsetMs(wall + DAY_MS, timeZone);
  const matches = [wall - offsetBefore, wall - offsetAfter].filter(
    (candidate) => wallClockAt(candidate, timeZone) === wall,
  );
  if (matches.length > 0) {
    return new Date(Math.min(...matches));
  }
  // Skipped by a forward jump: keep the offset from before the jump, which lands after it.
  return new Date(wall - offsetBefore);
}

/** The wall-clock date and time (to the minute) of an instant in `timeZone`. */
export function instantToZonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  const wall = new Date(wallClockAt(instant.getTime(), timeZone));
  const pad = (value: number): string => value.toString().padStart(2, '0');
  const year = wall.getUTCFullYear().toString().padStart(4, '0');
  return {
    date: `${year}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    time: `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`,
  };
}

/** The first instant of `date` in `timeZone`. */
export function startOfDayInTimeZone(date: IsoDateString, timeZone: string): Date {
  return zonedDateTimeToInstant(date, '00:00', timeZone);
}

/** Calendar arithmetic on `YYYY-MM-DD` strings, independent of any time zone. */
export function addDaysToIsoDate(date: IsoDateString, days: number): IsoDateString {
  const [year, month, day] = parseDate(date);
  const shifted = new Date(utcFromFields(year, month, day, 12, 0) + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}
