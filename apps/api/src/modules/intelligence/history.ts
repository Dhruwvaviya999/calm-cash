import {
  completedMonths,
  INTELLIGENCE_RULES,
  monthOf,
  type DataSufficiencyDto,
  type DataSufficiencyLevel,
  type IsoDateString,
} from '@calmcash/shared';

import type { MonthlyCategoryRow } from './intelligence.repository';
import type { MonthAmount } from './statistics';

// The history every estimate stands on: completed calendar months in the person's time zone, in
// one currency. Months before the first recorded income or expense are not history (they are not
// zero spending — nothing was recorded yet); the month of the first record counts only when it
// began in that month's first seven days, so a mid-month start does not look like a cheap month.
// After that, a month without spending is a real zero.

export const UNCATEGORIZED_KEY = 'uncategorized';

export interface MonthTotals {
  incomeMinor: bigint;
  expenseMinor: bigint;
  incomeCount: number;
  expenseCount: number;
  /** Recorded from recurring occurrences. */
  scheduledIncomeMinor: bigint;
  scheduledExpenseMinor: bigint;
}

export interface CategoryHistory {
  key: string;
  categoryId: string | null;
  name: string;
  archived: boolean;
  /** Per month: all expenses, and those not recorded from a schedule. */
  months: Map<string, { allMinor: bigint; variableMinor: bigint; count: number }>;
}

export interface History {
  today: IsoDateString;
  currentMonth: string;
  /** Completed months looked at (the last six), oldest first. */
  consideredMonths: string[];
  /** Of those, the months that count as history, oldest first. */
  months: string[];
  totals: Map<string, MonthTotals>;
  categories: Map<string, CategoryHistory>;
  firstActivityDate: IsoDateString | undefined;
}

function emptyTotals(): MonthTotals {
  return {
    incomeMinor: 0n,
    expenseMinor: 0n,
    incomeCount: 0,
    expenseCount: 0,
    scheduledIncomeMinor: 0n,
    scheduledExpenseMinor: 0n,
  };
}

/** The completed months that count as history (see the module comment). */
export function eligibleMonths(
  considered: readonly string[],
  firstActivityDate: IsoDateString | undefined,
): string[] {
  if (firstActivityDate === undefined) return [];
  const firstMonth = monthOf(firstActivityDate);
  const startsEarly = Number(firstActivityDate.slice(8, 10)) <= 7;
  return considered.filter((month) => month > firstMonth || (month === firstMonth && startsEarly));
}

export function buildHistory(
  rows: readonly MonthlyCategoryRow[],
  today: IsoDateString,
  firstActivityDate: IsoDateString | undefined,
  monthsConsidered: number = INTELLIGENCE_RULES.historyMonths,
): History {
  const consideredMonths = completedMonths(today, monthsConsidered).map((range) =>
    monthOf(range.from),
  );
  const totals = new Map<string, MonthTotals>();
  const categories = new Map<string, CategoryHistory>();
  for (const row of rows) {
    const month = totals.get(row.month) ?? emptyTotals();
    if (row.type === 'income') {
      month.incomeMinor += row.totalMinor;
      month.incomeCount += row.count;
      if (row.scheduled) month.scheduledIncomeMinor += row.totalMinor;
    } else {
      month.expenseMinor += row.totalMinor;
      month.expenseCount += row.count;
      if (row.scheduled) month.scheduledExpenseMinor += row.totalMinor;
      const key = row.categoryId ?? UNCATEGORIZED_KEY;
      const category: CategoryHistory = categories.get(key) ?? {
        key,
        categoryId: row.categoryId,
        name: row.name ?? 'Uncategorised',
        archived: row.archived,
        months: new Map(),
      };
      const entry = category.months.get(row.month) ?? { allMinor: 0n, variableMinor: 0n, count: 0 };
      entry.allMinor += row.totalMinor;
      if (!row.scheduled) entry.variableMinor += row.totalMinor;
      entry.count += row.count;
      category.months.set(row.month, entry);
      categories.set(key, category);
    }
    totals.set(row.month, month);
  }
  return {
    today,
    currentMonth: monthOf(today),
    consideredMonths,
    months: eligibleMonths(consideredMonths, firstActivityDate),
    totals,
    categories,
    firstActivityDate,
  };
}

export function monthTotals(history: History, month: string): MonthTotals {
  return history.totals.get(month) ?? emptyTotals();
}

/** One value per history month (zeros included), oldest first. */
export function series(history: History, pick: (totals: MonthTotals) => bigint): bigint[] {
  return history.months.map((month) => pick(monthTotals(history, month)));
}

/** Unscheduled spending per history month: what the variable-spending baseline is made of. */
export function variableSpendingSeries(history: History): bigint[] {
  return series(history, (totals) => totals.expenseMinor - totals.scheduledExpenseMinor);
}

export function unscheduledIncomeSeries(history: History): bigint[] {
  return series(history, (totals) => totals.incomeMinor - totals.scheduledIncomeMinor);
}

/** A category's spending per history month (zeros included), oldest first. */
export function categorySeries(
  history: History,
  category: CategoryHistory,
  part: 'all' | 'variable' = 'all',
): MonthAmount[] {
  return history.months.map((month) => {
    const entry = category.months.get(month);
    return {
      month,
      amountMinor: entry === undefined ? 0n : part === 'all' ? entry.allMinor : entry.variableMinor,
      count: entry?.count ?? 0,
    };
  });
}

/** History months in which the category had any spending. */
export function categoryActiveMonths(history: History, category: CategoryHistory): number {
  return history.months.filter((month) => (category.months.get(month)?.count ?? 0) > 0).length;
}

/** The level for a number of months with activity (the documented thresholds). */
export function levelForMonths(monthsWithActivity: number): DataSufficiencyLevel {
  if (monthsWithActivity < INTELLIGENCE_RULES.minMonthsForEstimate) return 'insufficient';
  if (monthsWithActivity < INTELLIGENCE_RULES.moderateMonths) return 'limited';
  if (monthsWithActivity < INTELLIGENCE_RULES.strongMonths) return 'moderate';
  return 'strong';
}

/**
 * Data sufficiency from measured facts: completed months with recorded spending and the number of
 * recorded expenses. Never from a model's self-reported confidence.
 */
export function sufficiencyOf(history: History): DataSufficiencyDto {
  const monthsWithActivity = history.months.filter(
    (month) => monthTotals(history, month).expenseCount > 0,
  ).length;
  const counts = history.months.map((month) => monthTotals(history, month));
  const expenseCount = counts.reduce((total, month) => total + month.expenseCount, 0);
  const transactionCount = counts.reduce(
    (total, month) => total + month.expenseCount + month.incomeCount,
    0,
  );
  let level = levelForMonths(monthsWithActivity);
  const notes: string[] = [];
  if (history.firstActivityDate === undefined) {
    notes.push('No income or spending has been recorded in this currency yet.');
  } else if (history.months.length < history.consideredMonths.length) {
    notes.push(
      `Recording started on ${history.firstActivityDate}, so ${history.months.length.toString()} of the last ${history.consideredMonths.length.toString()} completed months count as history.`,
    );
  }
  if (monthsWithActivity < history.months.length) {
    notes.push(
      `${(history.months.length - monthsWithActivity).toString()} of those months have no recorded spending.`,
    );
  }
  if (expenseCount < INTELLIGENCE_RULES.minExpensesForEstimate) {
    level = 'insufficient';
    notes.push(
      `Only ${expenseCount.toString()} expenses were recorded in completed months; estimates need at least ${INTELLIGENCE_RULES.minExpensesForEstimate.toString()}.`,
    );
  }
  if (level === 'insufficient' && monthsWithActivity < INTELLIGENCE_RULES.minMonthsForEstimate) {
    notes.push(
      `Estimates need spending in at least ${INTELLIGENCE_RULES.minMonthsForEstimate.toString()} completed months.`,
    );
  }
  return {
    level,
    monthsConsidered: history.consideredMonths.length,
    monthsWithActivity,
    transactionCount,
    ...(history.firstActivityDate === undefined
      ? {}
      : { firstActivityDate: history.firstActivityDate }),
    notes,
  };
}

export function canEstimate(level: DataSufficiencyLevel): boolean {
  return level !== 'insufficient';
}
