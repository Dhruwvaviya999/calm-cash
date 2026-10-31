import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  calendarDateInTimeZone,
  daysBetween,
  divideRounded,
  RECURRING_CANDIDATE_FREQUENCIES,
  type CategorySpendEntryDto,
  type RecurringCandidateFrequency,
} from '@calmcash/shared';

import type { ActivityRow, ScheduleRef } from './insights.repository';
import { payeeKey } from './merchant-key';

// Deterministic pattern rules. Every insight is computed from recorded transactions with fixed,
// documented thresholds; nothing here guesses a reason. Money stays `bigint`; ratios are basis
// points. Thresholds are deliberately conservative: an insight needs enough observations, and an
// unusually large expense is only "larger than usual for your records" — never a fraud claim.

const BP = 10_000n;

export const INSIGHT_RULES = {
  /** Category comparisons need at least this many expenses in each period. */
  minCategoryTransactions: 2,
  /** …a change of at least this much (basis points of the earlier amount)… */
  minCategoryChangeBp: 2_000n,
  /** …and at least this share of the larger period's total spending. */
  minShareOfSpendingBp: 500n,
  /** Unusual expenses need this many earlier expenses in the same category (180-day history). */
  minHistoryForUnusual: 8,
  historyDays: 180,
  /** An expense this many times the category's median, and above its 90th percentile, is unusual. */
  unusualMedianMultiple: 3n,
  /** A payee with at least this many expenses in the period counts as frequent. */
  minFrequentPayments: 5,
  /** Income changes of at least this much (basis points) are reported. */
  minIncomeChangeBp: 2_000n,
  maxPerKind: 3,
} as const;

export function median(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0n;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0n;
  return ((sorted[middle - 1] ?? 0n) + (sorted[middle] ?? 0n)) / 2n;
}

export function percentile(values: readonly bigint[], fraction: number): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.length === 0) return 0n;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0n;
}

/** Signed change in basis points of `before`; `undefined` when `before` is not positive. */
export function changeBp(before: bigint, after: bigint): bigint | undefined {
  return before > 0n ? divideRounded((after - before) * BP, before) : undefined;
}

// --- Category changes ----------------------------------------------------------------------------

export interface CategoryChange {
  categoryId: string;
  name: string;
  currentMinor: bigint;
  previousMinor: bigint;
  changeBp: bigint;
}

export function categoryChanges(
  current: readonly CategorySpendEntryDto[],
  previous: readonly CategorySpendEntryDto[],
  totals: { current: bigint; previous: bigint },
): { increases: CategoryChange[]; decreases: CategoryChange[] } {
  const earlier = new Map(
    previous.flatMap((entry) => (entry.kind === 'category' ? [[entry.categoryId, entry]] : [])),
  );
  const largerTotal = totals.current > totals.previous ? totals.current : totals.previous;
  const changes: CategoryChange[] = [];
  for (const entry of current) {
    if (entry.kind !== 'category') continue;
    const before = earlier.get(entry.categoryId);
    if (
      before === undefined ||
      entry.transactionCount < INSIGHT_RULES.minCategoryTransactions ||
      before.transactionCount < INSIGHT_RULES.minCategoryTransactions
    ) {
      continue;
    }
    const now = BigInt(entry.amountMinor);
    const then = BigInt(before.amountMinor);
    const change = changeBp(then, now);
    const delta = now > then ? now - then : then - now;
    if (
      change === undefined ||
      (change < 0n ? -change : change) < INSIGHT_RULES.minCategoryChangeBp ||
      delta * BP < INSIGHT_RULES.minShareOfSpendingBp * largerTotal
    ) {
      continue;
    }
    changes.push({
      categoryId: entry.categoryId,
      name: entry.name,
      currentMinor: now,
      previousMinor: then,
      changeBp: change,
    });
  }
  const byMagnitude = (a: CategoryChange, b: CategoryChange): number => {
    const left = a.changeBp < 0n ? -a.changeBp : a.changeBp;
    const right = b.changeBp < 0n ? -b.changeBp : b.changeBp;
    return left > right ? -1 : left < right ? 1 : a.name.localeCompare(b.name);
  };
  return {
    increases: changes
      .filter((c) => c.changeBp > 0n)
      .sort(byMagnitude)
      .slice(0, INSIGHT_RULES.maxPerKind),
    decreases: changes
      .filter((c) => c.changeBp < 0n)
      .sort(byMagnitude)
      .slice(0, INSIGHT_RULES.maxPerKind),
  };
}

// --- Unusual expenses ----------------------------------------------------------------------------

export interface UnusualExpense {
  row: ActivityRow;
  medianMinor: bigint;
  historyCount: number;
  /** Times the median, in basis points (e.g. 41500 = 4.15×). */
  multipleBp: bigint;
}

export function unusualExpenses(
  inPeriod: readonly ActivityRow[],
  history: readonly ActivityRow[],
): UnusualExpense[] {
  const byCategory = new Map<string, bigint[]>();
  for (const row of history) {
    if (row.type !== 'expense' || row.categoryId === null) continue;
    const key = `${row.currency}:${row.categoryId}`;
    byCategory.set(key, [...(byCategory.get(key) ?? []), row.amountMinor]);
  }
  const found: UnusualExpense[] = [];
  for (const row of inPeriod) {
    if (row.type !== 'expense' || row.categoryId === null) continue;
    const amounts = byCategory.get(`${row.currency}:${row.categoryId}`) ?? [];
    if (amounts.length < INSIGHT_RULES.minHistoryForUnusual) continue;
    const typical = median(amounts);
    if (typical <= 0n) continue;
    if (
      row.amountMinor >= typical * INSIGHT_RULES.unusualMedianMultiple &&
      row.amountMinor > percentile(amounts, 0.9)
    ) {
      found.push({
        row,
        medianMinor: typical,
        historyCount: amounts.length,
        multipleBp: divideRounded(row.amountMinor * BP, typical),
      });
    }
  }
  return found
    .sort((a, b) => (a.multipleBp > b.multipleBp ? -1 : a.multipleBp < b.multipleBp ? 1 : 0))
    .slice(0, INSIGHT_RULES.maxPerKind);
}

// --- Frequent payees -----------------------------------------------------------------------------

export interface FrequentPayee {
  key: string;
  /** The most recent merchant (or description) as recorded. */
  label: string;
  currency: string;
  count: number;
  totalMinor: bigint;
}

export function payeeTotals(rows: readonly ActivityRow[]): FrequentPayee[] {
  const groups = new Map<string, FrequentPayee>();
  for (const row of rows) {
    if (row.type !== 'expense') continue;
    const key = payeeKey(row.merchant, row.description);
    if (key.length < 3) continue;
    const id = `${row.currency}:${key}`;
    const group = groups.get(id) ?? {
      key,
      label: '',
      currency: row.currency,
      count: 0,
      totalMinor: 0n,
    };
    group.count += 1;
    group.totalMinor += row.amountMinor;
    group.label = row.merchant ?? row.description;
    groups.set(id, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.count - a.count || (a.totalMinor > b.totalMinor ? -1 : a.totalMinor < b.totalMinor ? 1 : 0),
  );
}

export function frequentPayees(rows: readonly ActivityRow[]): FrequentPayee[] {
  return payeeTotals(rows)
    .filter((group) => group.count >= INSIGHT_RULES.minFrequentPayments)
    .slice(0, INSIGHT_RULES.maxPerKind);
}

// --- Recurring candidates ------------------------------------------------------------------------

/** Nominal spacing and accepted range (days) of each rhythm. */
export const RECURRING_RULES: Readonly<
  Record<RecurringCandidateFrequency, { min: number; max: number; nominal: number }>
> = {
  weekly: { min: 5, max: 9, nominal: 7 },
  monthly: { min: 26, max: 35, nominal: 30 },
  quarterly: { min: 80, max: 101, nominal: 91 },
  yearly: { min: 345, max: 385, nominal: 365 },
};

export const CANDIDATE_RULES = {
  minOccurrences: 3,
  strongOccurrences: 5,
  /** Every amount within this share of the typical (median) amount (basis points). */
  maxAmountDeviationBp: 2_000n,
  strongAmountDeviationBp: 500n,
  /** Share of intervals that must fit the rhythm (basis points). */
  minRhythmShareBp: 7_500n,
  /** The last payment must be at most this many rhythm lengths ago (still active). */
  maxSilenceMultiple: 1.5,
  historyMonths: 13,
  maxCandidates: 10,
} as const;

export interface RecurringCandidate {
  key: string;
  label: string;
  merchant: string | undefined;
  currency: string;
  rows: ActivityRow[];
  frequency: RecurringCandidateFrequency;
  typicalMinor: bigint;
  minMinor: bigint;
  maxMinor: bigint;
  lastDate: string;
  nextEstimatedDate: string;
  strong: boolean;
  fitting: number;
  intervals: number;
}

function nextDate(last: string, frequency: RecurringCandidateFrequency): string {
  switch (frequency) {
    case 'weekly':
      return addDaysToIsoDate(last, 7);
    case 'monthly':
      return addMonthsToIsoDate(last, 1);
    case 'quarterly':
      return addMonthsToIsoDate(last, 3);
    case 'yearly':
      return addMonthsToIsoDate(last, 12);
  }
}

export function recurringCandidates(
  rows: readonly ActivityRow[],
  schedules: readonly ScheduleRef[],
  dismissed: ReadonlySet<string>,
  today: string,
  timeZone: string,
): RecurringCandidate[] {
  const covered = new Set(
    schedules.flatMap((schedule) => [
      `${schedule.currency}:${payeeKey(schedule.merchant, schedule.name)}`,
      `${schedule.currency}:${payeeKey(null, schedule.name)}`,
    ]),
  );
  const groups = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    if (row.type !== 'expense') continue;
    const key = payeeKey(row.merchant, row.description);
    if (key.length < 3) continue;
    const id = `${row.currency}:${key}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [id, group] of groups) {
    const key = `rc:${id.replace(/[^A-Za-z0-9:]+/g, '-')}`;
    if (group.length < CANDIDATE_RULES.minOccurrences || covered.has(id) || dismissed.has(key))
      continue;
    const dates = group.map((row) => calendarDateInTimeZone(row.occurredAt, timeZone));
    const intervals = dates.slice(1).map((date, index) => daysBetween(dates[index] ?? date, date));
    const medianInterval = Number(median(intervals.map((days) => BigInt(days))));
    const frequency = RECURRING_CANDIDATE_FREQUENCIES.find(
      (name) =>
        medianInterval >= RECURRING_RULES[name].min && medianInterval <= RECURRING_RULES[name].max,
    );
    if (frequency === undefined) continue;
    const rule = RECURRING_RULES[frequency];
    const fitting = intervals.filter((days) => days >= rule.min && days <= rule.max).length;
    if (BigInt(fitting) * BP < CANDIDATE_RULES.minRhythmShareBp * BigInt(intervals.length))
      continue;

    const amounts = group.map((row) => row.amountMinor);
    const typical = median(amounts);
    if (typical <= 0n) continue;
    const deviation = (amount: bigint): bigint =>
      divideRounded((amount > typical ? amount - typical : typical - amount) * BP, typical);
    const worst = amounts.reduce(
      (max, amount) => (deviation(amount) > max ? deviation(amount) : max),
      0n,
    );
    if (worst > CANDIDATE_RULES.maxAmountDeviationBp) continue;

    const lastDate = dates.at(-1) ?? today;
    if (daysBetween(lastDate, today) > rule.nominal * CANDIDATE_RULES.maxSilenceMultiple) continue;

    const last = group.at(-1);
    candidates.push({
      key,
      label: last?.merchant ?? last?.description ?? id,
      merchant: last?.merchant ?? undefined,
      currency: group[0]?.currency ?? '',
      rows: group,
      frequency,
      typicalMinor: typical,
      minMinor: amounts.reduce((min, amount) => (amount < min ? amount : min), typical),
      maxMinor: amounts.reduce((max, amount) => (amount > max ? amount : max), typical),
      lastDate,
      nextEstimatedDate: nextDate(lastDate, frequency),
      strong:
        group.length >= CANDIDATE_RULES.strongOccurrences &&
        fitting === intervals.length &&
        worst <= CANDIDATE_RULES.strongAmountDeviationBp,
      fitting,
      intervals: intervals.length,
    });
  }
  return candidates
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.rows.length - a.rows.length)
    .slice(0, CANDIDATE_RULES.maxCandidates);
}
