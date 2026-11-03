import type { SpendingPatternPreset } from '../constants/intelligence';
import { addDaysToIsoDate } from '../time/zoned-time';
import type { IsoDateString } from '../types/common';
import {
  addMonthsToIsoDate,
  daysBetween,
  daysInMonth,
  firstOfMonth,
  type CalendarRange,
} from './periods';

// Calendar ranges of the financial-intelligence views, on `YYYY-MM-DD` dates in the user's time
// zone. Pure and clock-free like `periods.ts`: callers pass "today".

export function lastOfMonth(date: IsoDateString): IsoDateString {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 7)}-${daysInMonth(year, month).toString().padStart(2, '0')}`;
}

/** `YYYY-MM` of a date. */
export function monthOf(date: IsoDateString): string {
  return date.slice(0, 7);
}

/**
 * The last `count` completed calendar months before the month of `today`, oldest first. Today's
 * month is never included: it is still running.
 */
export function completedMonths(today: IsoDateString, count: number): CalendarRange[] {
  const months: CalendarRange[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    const from = addMonthsToIsoDate(firstOfMonth(today), -offset);
    months.push({ from, to: lastOfMonth(from) });
  }
  return months;
}

/** The range of a spending-pattern preset; rolling presets end today. */
export function patternRange(preset: SpendingPatternPreset, today: IsoDateString): CalendarRange {
  switch (preset) {
    case 'last-30-days':
      return { from: addDaysToIsoDate(today, -29), to: today };
    case 'last-90-days':
      return { from: addDaysToIsoDate(today, -89), to: today };
    case 'last-6-months':
      return { from: addMonthsToIsoDate(firstOfMonth(today), -5), to: today };
    case 'last-12-months':
      return { from: addMonthsToIsoDate(firstOfMonth(today), -11), to: today };
    case 'this-year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'last-year': {
      const year = (Number(today.slice(0, 4)) - 1).toString().padStart(4, '0');
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}

/** The same number of days immediately before a range. */
export function precedingRange(range: CalendarRange): CalendarRange {
  const length = daysBetween(range.from, range.to) + 1;
  const to = addDaysToIsoDate(range.from, -1);
  return { from: addDaysToIsoDate(to, -(length - 1)), to };
}

/** Calendar months touched by a range, oldest first, with whether the range covers them fully. */
export function monthsInRange(
  range: CalendarRange,
): { month: string; from: IsoDateString; to: IsoDateString; partial: boolean }[] {
  const months: { month: string; from: IsoDateString; to: IsoDateString; partial: boolean }[] = [];
  for (
    let start = firstOfMonth(range.from);
    start <= range.to;
    start = addMonthsToIsoDate(start, 1)
  ) {
    const end = lastOfMonth(start);
    const from = start < range.from ? range.from : start;
    const to = end > range.to ? range.to : end;
    months.push({ month: monthOf(start), from, to, partial: from !== start || to !== end });
  }
  return months;
}
