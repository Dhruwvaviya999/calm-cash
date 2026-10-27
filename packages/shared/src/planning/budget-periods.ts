import {
  addMonthsToIsoDate,
  daysInMonth,
  firstOfMonth,
  startOfIsoWeek,
  type CalendarRange,
} from '../analytics/periods';
import type { BudgetPeriod } from '../constants/domain';
import type { BudgetTiming, RecurringBudgetPeriod } from '../constants/planning';
import { addDaysToIsoDate } from '../time/zoned-time';
import type { IsoDateString } from '../types/common';

// Budget periods are calendar periods in the user's time zone: ISO weeks (Monday to Sunday),
// calendar months, calendar quarters (January, April, July, October), and calendar years. A month
// is never 30 days. Everything here works on `YYYY-MM-DD` dates and never reads the clock.

function lastOfMonth(date: IsoDateString): IsoDateString {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 7)}-${daysInMonth(year, month).toString().padStart(2, '0')}`;
}

/** The whole calendar period of this kind that contains `date`. */
export function budgetPeriodContaining(
  period: RecurringBudgetPeriod,
  date: IsoDateString,
): CalendarRange {
  switch (period) {
    case 'weekly': {
      const from = startOfIsoWeek(date);
      return { from, to: addDaysToIsoDate(from, 6) };
    }
    case 'monthly':
      return { from: firstOfMonth(date), to: lastOfMonth(date) };
    case 'quarterly': {
      const month = Number(date.slice(5, 7));
      const firstMonth = month - ((month - 1) % 3);
      const from = `${date.slice(0, 4)}-${firstMonth.toString().padStart(2, '0')}-01`;
      return { from, to: addDaysToIsoDate(addMonthsToIsoDate(from, 3), -1) };
    }
    case 'yearly':
      return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
  }
}

/** A date in the period `offset` periods before (negative) or after (positive) `date`'s. */
export function shiftBudgetPeriod(
  period: RecurringBudgetPeriod,
  date: IsoDateString,
  offset: number,
): IsoDateString {
  const { from } = budgetPeriodContaining(period, date);
  switch (period) {
    case 'weekly':
      return addDaysToIsoDate(from, 7 * offset);
    case 'monthly':
      return addMonthsToIsoDate(from, offset);
    case 'quarterly':
      return addMonthsToIsoDate(from, 3 * offset);
    case 'yearly':
      return addMonthsToIsoDate(from, 12 * offset);
  }
}

export interface BudgetWindowRule {
  period: BudgetPeriod;
  /** First day the budget counts (inclusive). */
  startDate: IsoDateString;
  /** Last day the budget counts (inclusive); required for `custom`. */
  endDate?: IsoDateString | undefined;
}

export interface BudgetWindow extends CalendarRange {
  /** True when the budget's start or end date cuts the calendar period short. */
  partial: boolean;
  timing: BudgetTiming;
}

/**
 * The period of a budget to show for a reference date (usually today in the user's time zone).
 *
 * - A `custom` budget has exactly one period: its start to its end date.
 * - A recurring budget shows the calendar period containing the reference date, clipped to the
 *   budget's start and end dates. Before the budget starts, it shows its first period (`upcoming`);
 *   after it ends, its last period (`ended`), so final results stay visible.
 */
export function budgetWindow(rule: BudgetWindowRule, referenceDate: IsoDateString): BudgetWindow {
  const { startDate, endDate } = rule;
  let timing: BudgetTiming = 'current';
  if (referenceDate < startDate) {
    timing = 'upcoming';
  } else if (endDate !== undefined && referenceDate > endDate) {
    timing = 'ended';
  }

  if (rule.period === 'custom') {
    if (endDate === undefined) {
      throw new RangeError('A custom budget needs an end date.');
    }
    return { from: startDate, to: endDate, partial: false, timing };
  }

  const anchor = timing === 'upcoming' ? startDate : timing === 'ended' ? endDate : referenceDate;
  const calendar = budgetPeriodContaining(rule.period, anchor ?? referenceDate);
  const from = calendar.from < startDate ? startDate : calendar.from;
  const to = endDate !== undefined && calendar.to > endDate ? endDate : calendar.to;
  return { from, to, partial: from !== calendar.from || to !== calendar.to, timing };
}
