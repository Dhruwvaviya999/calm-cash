import { describe, expect, it } from 'vitest';

import { calendarDateInTimeZone } from '../time/calendar-date';
import { budgetPeriodContaining, budgetWindow, shiftBudgetPeriod } from './budget-periods';
import { alertThresholdProblems, calculateBudgetProgress } from './budget-progress';
import { calculateGoalProgress } from './goal-progress';
import {
  countOccurrences,
  firstOccurrenceOnOrAfter,
  firstUnresolvedOccurrence,
  isOccurrenceDate,
  nthOccurrence,
  occurrenceAfter,
  occurrencesBetween,
  pendingOccurrenceStatus,
  wholeMonthsBetween,
  type RecurrenceRule,
} from './recurrence';

describe('budget periods', () => {
  it('uses calendar weeks (Monday), months, quarters, and years', () => {
    expect(budgetPeriodContaining('weekly', '2026-10-28')).toEqual({
      from: '2026-10-26',
      to: '2026-11-01',
    });
    expect(budgetPeriodContaining('monthly', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(budgetPeriodContaining('monthly', '2028-02-10').to).toBe('2028-02-29');
    expect(budgetPeriodContaining('quarterly', '2026-05-31')).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
    expect(budgetPeriodContaining('yearly', '2026-07-01')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('moves between periods without month-length drift', () => {
    expect(shiftBudgetPeriod('monthly', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftBudgetPeriod('monthly', '2026-03-15', -1)).toBe('2026-02-01');
    expect(shiftBudgetPeriod('quarterly', '2026-11-20', 1)).toBe('2027-01-01');
    expect(shiftBudgetPeriod('weekly', '2026-10-28', -1)).toBe('2026-10-19');
  });

  it('clips recurring periods to the start and end dates and reports timing', () => {
    const rule = { period: 'monthly' as const, startDate: '2026-10-15', endDate: '2027-01-10' };
    expect(budgetWindow(rule, '2026-10-20')).toEqual({
      from: '2026-10-15',
      to: '2026-10-31',
      partial: true,
      timing: 'current',
    });
    expect(budgetWindow(rule, '2026-12-05')).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
      partial: false,
    });
    expect(budgetWindow(rule, '2026-09-01')).toMatchObject({
      from: '2026-10-15',
      timing: 'upcoming',
    });
    expect(budgetWindow(rule, '2027-03-01')).toMatchObject({
      from: '2027-01-01',
      to: '2027-01-10',
      timing: 'ended',
    });
  });

  it('gives a custom budget exactly one period', () => {
    const rule = { period: 'custom' as const, startDate: '2026-03-10', endDate: '2026-03-20' };
    expect(budgetWindow(rule, '2026-03-15')).toEqual({
      from: '2026-03-10',
      to: '2026-03-20',
      partial: false,
      timing: 'current',
    });
    expect(() => budgetWindow({ period: 'custom', startDate: '2026-03-10' }, '2026-03-15')).toThrow(
      RangeError,
    );
  });
});

describe('budget progress', () => {
  it('reports remaining and used exactly, never clamped', () => {
    expect(calculateBudgetProgress(1_000_000n, 250_000n, [8000], 'current')).toEqual({
      remainingMinor: 750_000n,
      usedBasisPoints: 2500n,
      status: 'on_track',
      reachedThresholdBp: undefined,
    });
    expect(calculateBudgetProgress(600_000n, 689_900n, [8000], 'current')).toMatchObject({
      remainingMinor: -89_900n,
      usedBasisPoints: 11_498n,
      status: 'over_budget',
      reachedThresholdBp: 8000,
    });
  });

  it('distinguishes approaching, reached, and over the limit with exact comparisons', () => {
    // 79.996 % rounds to 8000 bp but has not reached an 80 % alert.
    expect(calculateBudgetProgress(10_000_000n, 7_999_600n, [8000], 'current')).toMatchObject({
      usedBasisPoints: 8000n,
      status: 'on_track',
    });
    expect(calculateBudgetProgress(10_000n, 8_000n, [5000, 8000], 'current')).toMatchObject({
      status: 'approaching_limit',
      reachedThresholdBp: 8000,
    });
    expect(calculateBudgetProgress(10_000n, 6_000n, [5000, 8000], 'current')).toMatchObject({
      reachedThresholdBp: 5000,
    });
    expect(calculateBudgetProgress(10_000n, 10_000n, [8000], 'current').status).toBe(
      'limit_reached',
    );
    expect(calculateBudgetProgress(10_000n, 10_001n, [], 'current').status).toBe('over_budget');
    expect(calculateBudgetProgress(10_000n, 9_999n, [], 'current').status).toBe('on_track');
  });

  it('has no ratio without a limit and no status before the period starts', () => {
    expect(calculateBudgetProgress(0n, 500n, [8000], 'current')).toMatchObject({
      usedBasisPoints: undefined,
      status: 'not_applicable',
      remainingMinor: -500n,
    });
    expect(calculateBudgetProgress(10_000n, 0n, [8000], 'upcoming').status).toBe('not_applicable');
  });

  it('works beyond JavaScript safe integers', () => {
    const limit = 9_000_000_000_000_000_000n;
    expect(calculateBudgetProgress(limit, limit / 2n, [8000], 'current').usedBasisPoints).toBe(
      5000n,
    );
  });

  it('validates alert thresholds', () => {
    expect(alertThresholdProblems([8000])).toEqual([]);
    expect(alertThresholdProblems([])).toEqual([]);
    expect(alertThresholdProblems([5000, 7500, 9000])).toEqual([]);
    expect(alertThresholdProblems([9000, 8000])).toHaveLength(1);
    expect(alertThresholdProblems([8000, 8000])).toHaveLength(1);
    expect(alertThresholdProblems([10_000])).toHaveLength(1);
    expect(alertThresholdProblems([50])).toHaveLength(1);
    expect(alertThresholdProblems([1000, 2000, 3000, 4000])).toHaveLength(1);
    expect(alertThresholdProblems([80.5])).toHaveLength(1);
  });
});

describe('recurrence', () => {
  const monthEnd: RecurrenceRule = { frequency: 'monthly', interval: 1, startDate: '2026-01-31' };

  it('falls on the last day of shorter months and returns to the intended day', () => {
    expect(occurrencesBetween(monthEnd, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    expect(nthOccurrence(monthEnd, 1)).toBe('2026-02-28');
    expect(nthOccurrence({ ...monthEnd, startDate: '2028-01-31' }, 1)).toBe('2028-02-29');
  });

  it('handles 29 February in yearly schedules', () => {
    const leap: RecurrenceRule = { frequency: 'yearly', interval: 1, startDate: '2028-02-29' };
    expect(occurrencesBetween(leap, '2028-01-01', '2033-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
      '2033-02-28',
    ]);
    expect(isOccurrenceDate(leap, '2029-02-28')).toBe(true);
    expect(isOccurrenceDate(leap, '2029-03-01')).toBe(false);
  });

  it('supports intervals: every two weeks, quarterly, every two years', () => {
    const fortnightly: RecurrenceRule = {
      frequency: 'weekly',
      interval: 2,
      startDate: '2026-10-02',
    };
    expect(occurrencesBetween(fortnightly, '2026-10-01', '2026-11-15')).toEqual([
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
      '2026-11-13',
    ]);
    expect(isOccurrenceDate(fortnightly, '2026-10-09')).toBe(false);
    const quarterly: RecurrenceRule = {
      frequency: 'monthly',
      interval: 3,
      startDate: '2026-11-30',
    };
    expect(occurrencesBetween(quarterly, '2026-11-01', '2027-12-31')).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
      '2027-08-30',
      '2027-11-30',
    ]);
    const biennial: RecurrenceRule = { frequency: 'yearly', interval: 2, startDate: '2026-04-01' };
    expect(firstOccurrenceOnOrAfter(biennial, '2026-04-02')).toBe('2028-04-01');
  });

  it('respects the end date and finds the next occurrence', () => {
    const rule: RecurrenceRule = { ...monthEnd, endDate: '2026-04-15' };
    expect(occurrencesBetween(rule, '2026-01-01', '2026-12-31')).toHaveLength(3);
    expect(firstOccurrenceOnOrAfter(rule, '2026-04-01')).toBeUndefined();
    expect(occurrenceAfter(monthEnd, '2026-02-28')).toBe('2026-03-31');
    expect(firstOccurrenceOnOrAfter(monthEnd, '2025-12-01')).toBe('2026-01-31');
    expect(countOccurrences(monthEnd, '2026-01-01', '2026-12-31')).toBe(12);
    expect(occurrencesBetween(monthEnd, '2026-01-01', '2026-12-31', 2)).toHaveLength(2);
  });

  it('gives every occurrence one identity: its scheduled date', () => {
    const dates = occurrencesBetween(monthEnd, '2026-01-01', '2030-12-31');
    expect(new Set(dates).size).toBe(dates.length);
    for (const date of dates) {
      expect(isOccurrenceDate(monthEnd, date)).toBe(true);
    }
  });

  it('finds the first occurrence nobody resolved yet', () => {
    const resolved = new Set(['2026-01-31', '2026-03-31']);
    expect(firstUnresolvedOccurrence(monthEnd, '2026-01-31', (date) => resolved.has(date), 5)).toBe(
      '2026-02-28',
    );
    resolved.add('2026-02-28');
    expect(firstUnresolvedOccurrence(monthEnd, '2026-01-31', (date) => resolved.has(date), 5)).toBe(
      '2026-04-30',
    );
  });

  it('classifies pending occurrences against today in the user time zone', () => {
    // 18:45 UTC on 27 Oct is already 28 Oct in India but still 27 Oct in New York.
    const instant = new Date('2026-10-27T18:45:00.000Z');
    const india = calendarDateInTimeZone(instant, 'Asia/Kolkata');
    const newYork = calendarDateInTimeZone(instant, 'America/New_York');
    expect(pendingOccurrenceStatus('2026-10-27', india)).toBe('overdue');
    expect(pendingOccurrenceStatus('2026-10-27', newYork)).toBe('due');
    expect(pendingOccurrenceStatus('2026-10-28', newYork)).toBe('upcoming');
  });

  it('keeps calendar dates across daylight-saving changes', () => {
    // Clocks change in New York on 8 March and 1 November 2026; weekly dates do not move.
    const weekly: RecurrenceRule = { frequency: 'weekly', interval: 1, startDate: '2026-03-01' };
    expect(occurrencesBetween(weekly, '2026-03-01', '2026-03-15')).toEqual([
      '2026-03-01',
      '2026-03-08',
      '2026-03-15',
    ]);
    expect(firstOccurrenceOnOrAfter(weekly, '2026-11-01')).toBe('2026-11-01');
  });

  it('counts whole calendar months', () => {
    // One month after 31 January is 28 February (the day is clamped, as in schedules).
    expect(wholeMonthsBetween('2026-01-31', '2026-02-28')).toBe(1);
    expect(wholeMonthsBetween('2026-01-31', '2026-02-27')).toBe(0);
    expect(wholeMonthsBetween('2026-01-15', '2026-03-15')).toBe(2);
    expect(wholeMonthsBetween('2026-03-15', '2026-03-01')).toBe(0);
  });
});

describe('goal progress', () => {
  it('reports exact progress, beyond 100 % when exceeded', () => {
    expect(calculateGoalProgress(30_000_000n, 5_000_000n, undefined, '2026-10-27')).toEqual({
      remainingMinor: 25_000_000n,
      percentBasisPoints: 1667n,
      reached: false,
      daysRemaining: undefined,
      monthsRemaining: undefined,
      monthlyNeededMinor: undefined,
    });
    expect(calculateGoalProgress(100n, 150n, undefined, '2026-10-27')).toMatchObject({
      remainingMinor: -50n,
      percentBasisPoints: 15_000n,
      reached: true,
    });
    expect(calculateGoalProgress(0n, 10n, undefined, '2026-10-27')).toMatchObject({
      percentBasisPoints: undefined,
      reached: false,
    });
  });

  it('works out what is needed per month, rounded up', () => {
    expect(calculateGoalProgress(1_000n, 0n, '2027-01-27', '2026-10-27')).toMatchObject({
      daysRemaining: 92,
      monthsRemaining: 3,
      monthlyNeededMinor: 334n,
    });
    expect(calculateGoalProgress(1_000n, 0n, '2026-11-10', '2026-10-27')).toMatchObject({
      monthsRemaining: 1,
      monthlyNeededMinor: 1_000n,
    });
    expect(calculateGoalProgress(1_000n, 0n, '2026-10-01', '2026-10-27')).toMatchObject({
      daysRemaining: -26,
      monthlyNeededMinor: undefined,
    });
  });
});
