import {
  addMonthsToIsoDate,
  calculateGoalProgress,
  completedMonths,
  monthOf,
  serializeMinorUnits,
  type CurrencyCode,
  type GoalPaceDto,
  type GoalProjectionDto,
  type GoalProjectionState,
  type GoalSuggestionDto,
  type IsoDateString,
  type MonthlyAmountDto,
  type RatioDto,
  type SavingsGoalStatus,
} from '@calmcash/shared';

import { formatDate, formatMoney } from '../../lib/text-format';
import { monthsToCover } from './statistics';

// Savings-goal projections. A goal's progress is the sum of the allocations the person logged — a
// planning figure that never moves money — so the projection asks only: at the pace of recent
// allocations, when would the rest be covered?
//
//   pace                 = net allocations in the completed months since the first one (at most
//                          six) ÷ those months, rounded down
//   projected completion = today + ⌈remaining ÷ pace⌉ months
//   required per month   = ⌈remaining ÷ calendar months left until the target date⌉ (shared rule)
//
// Without at least two completed months of allocations, or with a pace of zero or less, no
// completion date is estimated — only the amount needed per month. Nothing is contributed or
// changed automatically.

export const PACE_MONTHS = 6;

export interface GoalInput {
  goalId: string;
  name: string;
  currency: CurrencyCode;
  status: SavingsGoalStatus;
  targetMinor: bigint;
  savedMinor: bigint;
  percent: RatioDto;
  contributionCount: number;
  targetDate: IsoDateString | undefined;
  /** First day an allocation applies to, if any. */
  firstContribution: IsoDateString | undefined;
  /** Net allocations per month (`YYYY-MM`). */
  monthly: ReadonlyMap<string, { amountMinor: bigint; count: number }>;
}

export function paceOf(
  goal: GoalInput,
  today: IsoDateString,
): { pace: GoalPaceDto; months: MonthlyAmountDto[] } {
  const firstMonth =
    goal.firstContribution === undefined ? undefined : monthOf(goal.firstContribution);
  const window = completedMonths(today, PACE_MONTHS)
    .map((range) => monthOf(range.from))
    .filter((month) => firstMonth !== undefined && month >= firstMonth);
  const months = window.map((month) => {
    const entry = goal.monthly.get(month);
    return {
      month,
      amountMinor: serializeMinorUnits(entry?.amountMinor ?? 0n),
      count: entry?.count ?? 0,
    };
  });
  if (goal.contributionCount === 0) {
    return { pace: { status: 'unavailable', reason: 'no_contributions' }, months };
  }
  if (window.length < 2) {
    return { pace: { status: 'unavailable', reason: 'too_little_history' }, months };
  }
  const net = window.reduce(
    (total, month) => total + (goal.monthly.get(month)?.amountMinor ?? 0n),
    0n,
  );
  const average = net / BigInt(window.length);
  if (average <= 0n) {
    return { pace: { status: 'unavailable', reason: 'not_increasing' }, months };
  }
  return {
    pace: {
      status: 'available',
      monthlyAverageMinor: serializeMinorUnits(average),
      monthsUsed: window.length,
      contributionCount: window.reduce(
        (total, month) => total + (goal.monthly.get(month)?.count ?? 0),
        0,
      ),
    },
    months,
  };
}

export interface GoalOutcome {
  state: GoalProjectionState;
  projectedCompletionDate: IsoDateString | undefined;
  requiredMonthlyMinor: bigint | undefined;
}

/** The state of a goal for a monthly pace (or none) and a target date (or none). */
export function outcomeFor(
  targetMinor: bigint,
  savedMinor: bigint,
  status: SavingsGoalStatus,
  targetDate: IsoDateString | undefined,
  monthlyPaceMinor: bigint | undefined,
  today: IsoDateString,
): GoalOutcome {
  const progress = calculateGoalProgress(targetMinor, savedMinor, targetDate, today);
  const remaining = targetMinor - savedMinor;
  const months =
    monthlyPaceMinor === undefined ? undefined : monthsToCover(remaining, monthlyPaceMinor);
  const projected =
    months === undefined || months === 0 ? undefined : addMonthsToIsoDate(today, months);
  const required = progress.monthlyNeededMinor;
  let state: GoalProjectionState;
  if (targetMinor <= 0n || progress.reached || status === 'completed') state = 'reached';
  else if (status === 'paused') state = 'paused';
  else if (targetDate !== undefined && (progress.daysRemaining ?? 0) <= 0)
    state = 'target_date_passed';
  else if (projected === undefined) state = 'insufficient_history';
  else if (targetDate === undefined) state = 'no_target_date';
  else state = projected <= targetDate ? 'on_track' : 'behind';
  return {
    state,
    projectedCompletionDate: state === 'reached' ? undefined : projected,
    requiredMonthlyMinor: state === 'reached' ? undefined : required,
  };
}

export function projectGoal(goal: GoalInput, today: IsoDateString): GoalProjectionDto {
  const { pace, months } = paceOf(goal, today);
  const paceMinor = pace.status === 'available' ? BigInt(pace.monthlyAverageMinor) : undefined;
  const outcome = outcomeFor(
    goal.targetMinor,
    goal.savedMinor,
    goal.status,
    goal.targetDate,
    paceMinor,
    today,
  );
  const money = (amount: bigint): string => formatMoney(amount, goal.currency);
  const suggestions: GoalSuggestionDto[] = [];
  const required = outcome.requiredMonthlyMinor;
  if (
    (outcome.state === 'behind' || outcome.state === 'insufficient_history') &&
    required !== undefined
  ) {
    suggestions.push({
      kind: 'increase_contribution',
      text: `Setting aside about ${money(required)} a month would reach the target by ${formatDate(goal.targetDate ?? today)}.`,
      amountMinor: serializeMinorUnits(required),
    });
  }
  if (outcome.state === 'behind' && outcome.projectedCompletionDate !== undefined) {
    suggestions.push({
      kind: 'extend_target_date',
      text: `At your recent pace the target would be reached around ${formatDate(outcome.projectedCompletionDate)}; moving the target date there is another option.`,
      date: outcome.projectedCompletionDate,
    });
  }
  if (outcome.state === 'target_date_passed' && outcome.projectedCompletionDate !== undefined) {
    suggestions.push({
      kind: 'extend_target_date',
      text: `The target date has passed. At your recent pace the rest would be covered around ${formatDate(outcome.projectedCompletionDate)}.`,
      date: outcome.projectedCompletionDate,
    });
  }
  if (outcome.state === 'no_target_date' && outcome.projectedCompletionDate !== undefined) {
    suggestions.push({
      kind: 'set_target_date',
      text: `At your recent pace you could reach it around ${formatDate(outcome.projectedCompletionDate)}. A target date would show the monthly amount needed.`,
      date: outcome.projectedCompletionDate,
    });
  }
  return {
    goalId: goal.goalId,
    name: goal.name,
    currency: goal.currency,
    status: goal.status,
    savedMinor: serializeMinorUnits(goal.savedMinor),
    targetMinor: serializeMinorUnits(goal.targetMinor),
    remainingMinor: serializeMinorUnits(goal.targetMinor - goal.savedMinor),
    percent: goal.percent,
    ...(goal.targetDate === undefined ? {} : { targetDate: goal.targetDate }),
    ...(required === undefined ? {} : { requiredMonthlyMinor: serializeMinorUnits(required) }),
    pace,
    ...(outcome.projectedCompletionDate === undefined
      ? {}
      : { projectedCompletionDate: outcome.projectedCompletionDate }),
    state: outcome.state,
    recentMonths: months,
    suggestions,
  };
}
