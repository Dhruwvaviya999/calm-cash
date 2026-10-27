import { divideRounded } from '../analytics/ratios';
import {
  MAX_BUDGET_ALERT_THRESHOLD_BP,
  MAX_BUDGET_ALERT_THRESHOLDS,
  MIN_BUDGET_ALERT_THRESHOLD_BP,
  type BudgetProgressStatus,
  type BudgetTiming,
} from '../constants/planning';

// Budget progress in exact integer arithmetic. "Used" is spending ÷ limit in basis points, rounded
// half away from zero only for the reported figure; every status decision compares the exact
// amounts, so 79.996 % never counts as having reached an 80 % alert.

const BASIS_POINTS = 10_000n;

export interface BudgetProgressFigures {
  /** Limit − spent. Negative when overspent; never clamped to zero. */
  remainingMinor: bigint;
  /** Spent ÷ limit in basis points (may exceed 10 000); `undefined` without a positive limit. */
  usedBasisPoints: bigint | undefined;
  status: BudgetProgressStatus;
  /** The highest alert threshold reached, when one is. */
  reachedThresholdBp: number | undefined;
}

/**
 * Status rules:
 * - a period that has not started (`upcoming`), or a limit that is not positive: `not_applicable`;
 * - spent > limit: `over_budget`; spent = limit: `limit_reached`;
 * - spent ≥ an alert threshold (below 100 %): `approaching_limit`;
 * - otherwise `on_track`.
 */
export function calculateBudgetProgress(
  limitMinor: bigint,
  spentMinor: bigint,
  alertThresholdsBp: readonly number[],
  timing: BudgetTiming,
): BudgetProgressFigures {
  const remainingMinor = limitMinor - spentMinor;
  if (limitMinor <= 0n) {
    return {
      remainingMinor,
      usedBasisPoints: undefined,
      status: 'not_applicable',
      reachedThresholdBp: undefined,
    };
  }
  const usedBasisPoints = divideRounded(spentMinor * BASIS_POINTS, limitMinor);
  const reached = [...alertThresholdsBp]
    .sort((a, b) => b - a)
    .find((threshold) => spentMinor * BASIS_POINTS >= BigInt(threshold) * limitMinor);

  let status: BudgetProgressStatus;
  if (timing === 'upcoming') {
    status = 'not_applicable';
  } else if (spentMinor > limitMinor) {
    status = 'over_budget';
  } else if (spentMinor === limitMinor) {
    status = 'limit_reached';
  } else if (reached !== undefined) {
    status = 'approaching_limit';
  } else {
    status = 'on_track';
  }
  return {
    remainingMinor,
    usedBasisPoints,
    status,
    reachedThresholdBp: timing === 'upcoming' ? undefined : reached,
  };
}

/** Problems with a list of alert thresholds; empty when it is valid. */
export function alertThresholdProblems(thresholds: readonly number[]): string[] {
  const problems: string[] = [];
  if (thresholds.length > MAX_BUDGET_ALERT_THRESHOLDS) {
    problems.push(`Use at most ${MAX_BUDGET_ALERT_THRESHOLDS} alerts.`);
  }
  if (
    thresholds.some(
      (value) =>
        !Number.isInteger(value) ||
        value < MIN_BUDGET_ALERT_THRESHOLD_BP ||
        value > MAX_BUDGET_ALERT_THRESHOLD_BP,
    )
  ) {
    problems.push(
      `Alerts are between ${MIN_BUDGET_ALERT_THRESHOLD_BP / 100}% and ${MAX_BUDGET_ALERT_THRESHOLD_BP / 100}% of the limit; reaching the limit is always shown.`,
    );
  }
  if (thresholds.some((value, index) => index > 0 && value <= (thresholds[index - 1] ?? 0))) {
    problems.push('List alerts from lowest to highest, each one only once.');
  }
  return problems;
}
