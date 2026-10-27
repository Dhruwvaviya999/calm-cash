import {
  savingsGoalDetailDtoSchema,
  savingsGoalListDtoSchema,
  type CreateSavingsGoalInput,
  type EntityId,
  type GoalContributionInput,
  type SavingsGoalDetailDto,
  type SavingsGoalListDto,
  type SavingsGoalStatusFilter,
  type UpdateSavingsGoalInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per savings-goals endpoint; every response is validated against the shared schema.
// Contributions are planning allocations: they never move money between accounts.

function goalPath(goalId: EntityId): `/${string}` {
  return `/goals/${encodeURIComponent(goalId)}`;
}

export function listGoals(
  status: SavingsGoalStatusFilter,
  signal?: AbortSignal,
): Promise<SavingsGoalListDto> {
  return api.request(`/goals?status=${status}`, { schema: savingsGoalListDtoSchema, signal });
}

export function getGoal(goalId: EntityId, signal?: AbortSignal): Promise<SavingsGoalDetailDto> {
  return api.request(goalPath(goalId), { schema: savingsGoalDetailDtoSchema, signal });
}

export function createGoal(input: CreateSavingsGoalInput): Promise<SavingsGoalDetailDto> {
  return api.request('/goals', {
    schema: savingsGoalDetailDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateGoal(
  goalId: EntityId,
  input: UpdateSavingsGoalInput,
): Promise<SavingsGoalDetailDto> {
  return api.request(goalPath(goalId), {
    schema: savingsGoalDetailDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export function addGoalContribution(
  goalId: EntityId,
  input: GoalContributionInput,
): Promise<SavingsGoalDetailDto> {
  return api.request(`${goalPath(goalId)}/contributions`, {
    schema: savingsGoalDetailDtoSchema,
    method: 'POST',
    body: input,
  });
}

export type GoalAction = 'pause' | 'resume' | 'complete' | 'reopen' | 'archive' | 'restore';

export function changeGoal(goalId: EntityId, action: GoalAction): Promise<SavingsGoalDetailDto> {
  return api.request(`${goalPath(goalId)}/${action}`, {
    schema: savingsGoalDetailDtoSchema,
    method: 'POST',
  });
}
