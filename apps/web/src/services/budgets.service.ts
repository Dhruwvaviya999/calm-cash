import {
  budgetListDtoSchema,
  budgetSummaryDtoSchema,
  budgetWithProgressDtoSchema,
  type BudgetListDto,
  type BudgetSummaryDto,
  type BudgetWithProgressDto,
  type CreateBudgetInput,
  type EntityId,
  type UpdateBudgetInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per budgets endpoint; every response is validated against the shared schema.
// Spending, remaining amounts, and statuses are always calculated by the API.

function budgetPath(budgetId: EntityId): `/${string}` {
  return `/budgets/${encodeURIComponent(budgetId)}`;
}

function withQuery(path: `/${string}`, query: string): `/${string}` {
  return query === '' ? path : `${path}?${query}`;
}

/** `query` is a URL query string without the leading `?` (e.g. `status=active&date=…`). */
export function listBudgets(query: string, signal?: AbortSignal): Promise<BudgetListDto> {
  return api.request(withQuery('/budgets', query), { schema: budgetListDtoSchema, signal });
}

export function getBudgetSummary(query: string, signal?: AbortSignal): Promise<BudgetSummaryDto> {
  return api.request(withQuery('/budgets/summary', query), {
    schema: budgetSummaryDtoSchema,
    signal,
  });
}

export function getBudget(
  budgetId: EntityId,
  query: string,
  signal?: AbortSignal,
): Promise<BudgetWithProgressDto> {
  return api.request(withQuery(budgetPath(budgetId), query), {
    schema: budgetWithProgressDtoSchema,
    signal,
  });
}

export function createBudget(input: CreateBudgetInput): Promise<BudgetWithProgressDto> {
  return api.request('/budgets', {
    schema: budgetWithProgressDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateBudget(
  budgetId: EntityId,
  input: UpdateBudgetInput,
): Promise<BudgetWithProgressDto> {
  return api.request(budgetPath(budgetId), {
    schema: budgetWithProgressDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export function archiveBudget(budgetId: EntityId): Promise<BudgetWithProgressDto> {
  return api.request(`${budgetPath(budgetId)}/archive`, {
    schema: budgetWithProgressDtoSchema,
    method: 'POST',
  });
}

export function restoreBudget(budgetId: EntityId): Promise<BudgetWithProgressDto> {
  return api.request(`${budgetPath(budgetId)}/restore`, {
    schema: budgetWithProgressDtoSchema,
    method: 'POST',
  });
}
