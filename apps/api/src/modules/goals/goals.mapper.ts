import {
  calculateGoalProgress,
  currencyCodeSchema,
  serializeMinorUnits,
  type GoalContributionDto,
  type GoalProgressDto,
  type IsoDateString,
  type SavingsGoalDto,
  type SavingsGoalStatus,
} from '@calmcash/shared';

import { toIsoDate } from '../../lib/calendar-dates';
import type { ContributionRecord, GoalRecord, SavedTotal } from './goals.repository';

// Database rows → public DTOs. Progress is calculated here from the contributions' sum, with
// exact integer arithmetic (`calculateGoalProgress`).

export function goalStatus(
  goal: Pick<GoalRecord, 'archivedAt' | 'completedAt' | 'pausedAt'>,
): SavingsGoalStatus {
  if (goal.archivedAt !== null) return 'archived';
  if (goal.completedAt !== null) return 'completed';
  if (goal.pausedAt !== null) return 'paused';
  return 'active';
}

export function toGoalDto(goal: GoalRecord): SavingsGoalDto {
  return {
    id: goal.id,
    userId: goal.userId,
    name: goal.name,
    ...(goal.description === null ? {} : { description: goal.description }),
    targetMinor: serializeMinorUnits(goal.targetMinor),
    currency: currencyCodeSchema.parse(goal.currency),
    ...(goal.targetDate === null ? {} : { targetDate: toIsoDate(goal.targetDate) }),
    status: goalStatus(goal),
    ...(goal.pausedAt === null ? {} : { pausedAt: goal.pausedAt.toISOString() }),
    ...(goal.completedAt === null ? {} : { completedAt: goal.completedAt.toISOString() }),
    ...(goal.archivedAt === null ? {} : { archivedAt: goal.archivedAt.toISOString() }),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export function toGoalProgressDto(
  goal: Pick<GoalRecord, 'targetMinor' | 'targetDate'>,
  saved: SavedTotal,
  today: IsoDateString,
): GoalProgressDto {
  const figures = calculateGoalProgress(
    goal.targetMinor,
    saved.savedMinor,
    goal.targetDate === null ? undefined : toIsoDate(goal.targetDate),
    today,
  );
  return {
    savedMinor: serializeMinorUnits(saved.savedMinor),
    remainingMinor: serializeMinorUnits(figures.remainingMinor),
    percent:
      figures.percentBasisPoints === undefined
        ? { status: 'unavailable', reason: 'no_target' }
        : { status: 'available', basisPoints: figures.percentBasisPoints.toString() },
    reached: figures.reached,
    ...(figures.daysRemaining === undefined ? {} : { daysRemaining: figures.daysRemaining }),
    ...(figures.monthlyNeededMinor === undefined
      ? {}
      : { monthlyNeededMinor: serializeMinorUnits(figures.monthlyNeededMinor) }),
    contributionCount: saved.count,
  };
}

export function toContributionDto(contribution: ContributionRecord): GoalContributionDto {
  return {
    id: contribution.id,
    goalId: contribution.goalId,
    amountMinor: serializeMinorUnits(contribution.amountMinor),
    contributedOn: toIsoDate(contribution.contributedOn),
    ...(contribution.note === null ? {} : { note: contribution.note }),
    createdAt: contribution.createdAt.toISOString(),
  };
}
