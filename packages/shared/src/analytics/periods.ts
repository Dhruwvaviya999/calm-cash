import type { DashboardPreset, TrendGranularity } from '../constants/dashboard';
import { addDaysToIsoDate } from '../time/zoned-time';
import type { IsoDateString } from '../types/common';

// Calendar periods of the dashboard. Everything here works on `YYYY-MM-DD` calendar dates in the
// user's time zone; the API turns them into instants with `startOfDayInTimeZone` (a range covers
// `from` 00:00 up to, not including, the day after `to`). No function here reads the clock.

/** An inclusive range of calendar dates. */
export interface CalendarRange {
  from: IsoDateString;
  to: IsoDateString;
}

const DAY_MS = 86_400_000;

function parts(date: IsoDateString): [number, number, number] {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  return [year, month, day];
}

function format(year: number, month: number, day: number): IsoDateString {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function utcNoon(date: IsoDateString): number {
  const [year, month, day] = parts(date);
  return Date.UTC(year, month - 1, day, 12);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from `from` to `to` (`to − from`), across months and years. */
export function daysBetween(from: IsoDateString, to: IsoDateString): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / DAY_MS);
}

/** Calendar months added to a date; the day is clamped to the target month's length. */
export function addMonthsToIsoDate(date: IsoDateString, months: number): IsoDateString {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return format(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function firstOfMonth(date: IsoDateString): IsoDateString {
  return `${date.slice(0, 7)}-01`;
}

export function isLastDayOfMonth(date: IsoDateString): boolean {
  const [year, month, day] = parts(date);
  return day === daysInMonth(year, month);
}

function lastOfMonth(date: IsoDateString): IsoDateString {
  const [year, month] = parts(date);
  return format(year, month, daysInMonth(year, month));
}

/** Months spanned by each month-aligned preset (used to find the comparable previous period). */
const PRESET_MONTHS: Readonly<Record<DashboardPreset, number>> = {
  'this-month': 1,
  'last-month': 1,
  'last-3-months': 3,
  'last-6-months': 6,
  'this-year': 12,
};

/**
 * The range of a preset for a user whose calendar shows `today`. Current periods end today (they
 * are partial); "last month" is the whole previous calendar month.
 */
export function presetRange(preset: DashboardPreset, today: IsoDateString): CalendarRange {
  switch (preset) {
    case 'this-month':
      return { from: firstOfMonth(today), to: today };
    case 'last-month': {
      const from = addMonthsToIsoDate(firstOfMonth(today), -1);
      return { from, to: lastOfMonth(from) };
    }
    case 'last-3-months':
      return { from: addMonthsToIsoDate(firstOfMonth(today), -2), to: today };
    case 'last-6-months':
      return { from: addMonthsToIsoDate(firstOfMonth(today), -5), to: today };
    case 'this-year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/**
 * The comparable earlier period. Presets shift back by their length in calendar months, keeping
 * partial periods partial (1–27 Oct compares with 1–27 Sep) and whole months whole (all of
 * September compares with all of August). A custom range compares with the same number of days
 * immediately before it.
 */
export function previousRange(
  range: CalendarRange,
  preset: DashboardPreset | 'custom',
): CalendarRange {
  if (preset === 'custom') {
    const length = daysBetween(range.from, range.to) + 1;
    const to = addDaysToIsoDate(range.from, -1);
    return { from: addDaysToIsoDate(to, -(length - 1)), to };
  }
  const months = PRESET_MONTHS[preset];
  const from = addMonthsToIsoDate(range.from, -months);
  const shifted = addMonthsToIsoDate(range.to, -months);
  return { from, to: isLastDayOfMonth(range.to) ? lastOfMonth(shifted) : shifted };
}

/** Bucket size for a range: days for about a month, weeks up to about six months, then months. */
export function trendGranularity(range: CalendarRange): TrendGranularity {
  const days = daysBetween(range.from, range.to) + 1;
  if (days <= 45) return 'day';
  if (days <= 190) return 'week';
  if (days <= 1100) return 'month';
  return 'year';
}

/** Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: IsoDateString): IsoDateString {
  const weekday = new Date(utcNoon(date)).getUTCDay(); // 0 = Sunday
  return addDaysToIsoDate(date, -((weekday + 6) % 7));
}

/** The first day of the bucket containing `date` (what PostgreSQL's `date_trunc` returns). */
export function bucketKey(date: IsoDateString, granularity: TrendGranularity): IsoDateString {
  switch (granularity) {
    case 'day':
      return date;
    case 'week':
      return startOfIsoWeek(date);
    case 'month':
      return firstOfMonth(date);
    case 'year':
      return `${date.slice(0, 4)}-01-01`;
  }
}

function nextBucketKey(key: IsoDateString, granularity: TrendGranularity): IsoDateString {
  switch (granularity) {
    case 'day':
      return addDaysToIsoDate(key, 1);
    case 'week':
      return addDaysToIsoDate(key, 7);
    case 'month':
      return addMonthsToIsoDate(key, 1);
    case 'year':
      return addMonthsToIsoDate(key, 12);
  }
}

export interface TrendBucketRange {
  /** Bucket identity: its first calendar day, even when the range starts later. */
  key: IsoDateString;
  /** First and last day of the bucket that fall inside the range. */
  start: IsoDateString;
  end: IsoDateString;
  /** True when the range covers only part of the bucket. */
  partial: boolean;
}

/** Every bucket of the range, in order, including those without any activity. */
export function trendBuckets(
  range: CalendarRange,
  granularity: TrendGranularity,
): TrendBucketRange[] {
  const buckets: TrendBucketRange[] = [];
  let key = bucketKey(range.from, granularity);
  while (key <= range.to) {
    const next = nextBucketKey(key, granularity);
    const last = addDaysToIsoDate(next, -1);
    const start = key < range.from ? range.from : key;
    const end = last > range.to ? range.to : last;
    buckets.push({ key, start, end, partial: start !== key || end !== last });
    key = next;
  }
  return buckets;
}
