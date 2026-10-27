import { addMonthsToIsoDate, daysBetween } from '../analytics/periods';
import type { RecurringFrequency } from '../constants/planning';
import { addDaysToIsoDate } from '../time/zoned-time';
import type { IsoDateString } from '../types/common';

// The recurrence engine: which calendar dates a schedule falls on. Dates are `YYYY-MM-DD` in the
// user's time zone, so daylight-saving changes cannot move them. Every date is computed from the
// start date (the anchor), never from the previous occurrence:
//
// - weekly: the start date's weekday, every `interval` weeks;
// - monthly: the start date's day of the month, every `interval` months. In a month without that
//   day the occurrence falls on the month's last day (31 Jan → 28/29 Feb → 31 Mar), and the next
//   month returns to the intended day, so a short month never drags the schedule earlier;
// - yearly: the start date's month and day, every `interval` years; 29 February falls on
//   28 February in common years.
//
// Nothing here reads the clock.

export interface RecurrenceRule {
  frequency: RecurringFrequency;
  /** Positive whole number: every `interval` weeks, months, or years. */
  interval: number;
  /** The first occurrence. */
  startDate: IsoDateString;
  /** No occurrence falls after this date (inclusive). */
  endDate?: IsoDateString | undefined;
}

function monthIndex(date: IsoDateString): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** Months per step of the rule (0 for weekly rules). */
function monthsPerStep(rule: RecurrenceRule): number {
  return rule.frequency === 'monthly'
    ? rule.interval
    : rule.frequency === 'yearly'
      ? rule.interval * 12
      : 0;
}

/** The `n`-th occurrence (0 = the start date), ignoring the end date. */
export function nthOccurrence(rule: RecurrenceRule, n: number): IsoDateString {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('Occurrence numbers are whole numbers from 0.');
  }
  return rule.frequency === 'weekly'
    ? addDaysToIsoDate(rule.startDate, 7 * rule.interval * n)
    : addMonthsToIsoDate(rule.startDate, monthsPerStep(rule) * n);
}

/** The number of the occurrence on `date`, or `undefined` when the rule does not fall on it. */
export function occurrenceNumber(rule: RecurrenceRule, date: IsoDateString): number | undefined {
  if (date < rule.startDate || (rule.endDate !== undefined && date > rule.endDate)) {
    return undefined;
  }
  let n: number;
  if (rule.frequency === 'weekly') {
    const days = daysBetween(rule.startDate, date);
    const step = 7 * rule.interval;
    if (days % step !== 0) return undefined;
    n = days / step;
  } else {
    const months = monthIndex(date) - monthIndex(rule.startDate);
    const step = monthsPerStep(rule);
    if (months % step !== 0) return undefined;
    n = months / step;
  }
  return nthOccurrence(rule, n) === date ? n : undefined;
}

export function isOccurrenceDate(rule: RecurrenceRule, date: IsoDateString): boolean {
  return occurrenceNumber(rule, date) !== undefined;
}

/** The number of the first occurrence on or after `date` (ignoring the end date). */
function firstNumberOnOrAfter(rule: RecurrenceRule, date: IsoDateString): number {
  if (date <= rule.startDate) {
    return 0;
  }
  let n =
    rule.frequency === 'weekly'
      ? Math.floor(daysBetween(rule.startDate, date) / (7 * rule.interval))
      : Math.floor((monthIndex(date) - monthIndex(rule.startDate)) / monthsPerStep(rule));
  while (nthOccurrence(rule, n) < date) {
    n += 1;
  }
  return n;
}

/** The first occurrence on or after `date`, or `undefined` when the rule has ended by then. */
export function firstOccurrenceOnOrAfter(
  rule: RecurrenceRule,
  date: IsoDateString,
): IsoDateString | undefined {
  const occurrence = nthOccurrence(rule, firstNumberOnOrAfter(rule, date));
  return rule.endDate !== undefined && occurrence > rule.endDate ? undefined : occurrence;
}

/** The occurrence after `date` (which need not be an occurrence itself). */
export function occurrenceAfter(
  rule: RecurrenceRule,
  date: IsoDateString,
): IsoDateString | undefined {
  return firstOccurrenceOnOrAfter(rule, addDaysToIsoDate(date, 1));
}

/**
 * Occurrences from `from` to `to` (both inclusive), within the rule's start and end dates, in
 * order and at most `limit` of them.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  from: IsoDateString,
  to: IsoDateString,
  limit = Number.POSITIVE_INFINITY,
): IsoDateString[] {
  const last = rule.endDate !== undefined && rule.endDate < to ? rule.endDate : to;
  const dates: IsoDateString[] = [];
  for (let n = firstNumberOnOrAfter(rule, from); dates.length < limit; n += 1) {
    const date = nthOccurrence(rule, n);
    if (date > last) break;
    dates.push(date);
  }
  return dates;
}

/** How many times the rule falls between `from` and `to` (inclusive). */
export function countOccurrences(
  rule: RecurrenceRule,
  from: IsoDateString,
  to: IsoDateString,
): number {
  return occurrencesBetween(rule, from, to).length;
}

/**
 * The first occurrence on or after `from` that `isResolved` does not claim: the next one still
 * expected. `undefined` once the rule has ended. Stops after `maxSteps` resolved dates in a row,
 * which callers bound by the number of resolved occurrences they hold.
 */
export function firstUnresolvedOccurrence(
  rule: RecurrenceRule,
  from: IsoDateString,
  isResolved: (date: IsoDateString) => boolean,
  maxSteps: number,
): IsoDateString | undefined {
  let date = firstOccurrenceOnOrAfter(rule, from);
  for (let step = 0; date !== undefined && isResolved(date); step += 1) {
    if (step > maxSteps) {
      throw new RangeError('Too many resolved occurrences in a row.');
    }
    date = occurrenceAfter(rule, date);
  }
  return date;
}

/** `upcoming`, `due` (today), or `overdue` for an occurrence that is still expected. */
export function pendingOccurrenceStatus(
  dueDate: IsoDateString,
  today: IsoDateString,
): 'upcoming' | 'due' | 'overdue' {
  return dueDate > today ? 'upcoming' : dueDate === today ? 'due' : 'overdue';
}

/** Whole calendar months from `from` to `to`, counting only completed months (never negative). */
export function wholeMonthsBetween(from: IsoDateString, to: IsoDateString): number {
  if (to <= from) return 0;
  let months = monthIndex(to) - monthIndex(from);
  if (addMonthsToIsoDate(from, months) > to) {
    months -= 1;
  }
  return Math.max(0, months);
}
