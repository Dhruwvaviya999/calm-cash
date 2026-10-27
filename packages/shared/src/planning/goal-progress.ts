import { daysBetween } from '../analytics/periods';
import { divideRounded } from '../analytics/ratios';
import type { IsoDateString } from '../types/common';
import { wholeMonthsBetween } from './recurrence';

// Savings-goal progress, in exact integer arithmetic. The tracked amount is a planning figure (the
// sum of the person's allocations), not an account balance and not the dashboard's cash-flow
// savings rate.

const BASIS_POINTS = 10_000n;

export interface GoalProgressFigures {
  /** Target − saved; negative once the target is exceeded. */
  remainingMinor: bigint;
  /** Saved ÷ target in basis points (may exceed 10 000); `undefined` without a positive target. */
  percentBasisPoints: bigint | undefined;
  reached: boolean;
  /** Days from today to the target date; negative once it has passed. */
  daysRemaining: number | undefined;
  /** Calendar months left (at least 1 while the date is ahead). */
  monthsRemaining: number | undefined;
  /** Remaining ÷ months left, rounded up so the target is not missed by a fraction. */
  monthlyNeededMinor: bigint | undefined;
}

export function calculateGoalProgress(
  targetMinor: bigint,
  savedMinor: bigint,
  targetDate: IsoDateString | undefined,
  today: IsoDateString,
): GoalProgressFigures {
  const remainingMinor = targetMinor - savedMinor;
  const percentBasisPoints =
    targetMinor > 0n ? divideRounded(savedMinor * BASIS_POINTS, targetMinor) : undefined;
  const reached = targetMinor > 0n && savedMinor >= targetMinor;

  if (targetDate === undefined) {
    return {
      remainingMinor,
      percentBasisPoints,
      reached,
      daysRemaining: undefined,
      monthsRemaining: undefined,
      monthlyNeededMinor: undefined,
    };
  }
  const daysRemaining = daysBetween(today, targetDate);
  const monthsRemaining =
    daysRemaining > 0 ? Math.max(1, wholeMonthsBetween(today, targetDate)) : undefined;
  const monthlyNeededMinor =
    monthsRemaining !== undefined && remainingMinor > 0n
      ? (remainingMinor + BigInt(monthsRemaining) - 1n) / BigInt(monthsRemaining)
      : undefined;
  return {
    remainingMinor,
    percentBasisPoints,
    reached,
    daysRemaining,
    monthsRemaining,
    monthlyNeededMinor,
  };
}
