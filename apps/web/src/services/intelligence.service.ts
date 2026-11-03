import {
  budgetRecommendationsDtoSchema,
  cashFlowForecastDtoSchema,
  financialHealthDtoSchema,
  financialScenarioDtoSchema,
  goalProjectionsDtoSchema,
  intelligenceExplanationDtoSchema,
  intelligenceOverviewDtoSchema,
  recommendationListDtoSchema,
  recommendationStateDtoSchema,
  scenarioComparisonDtoSchema,
  scenarioListDtoSchema,
  scenarioResultDtoSchema,
  spendingForecastDtoSchema,
  spendingPatternsDtoSchema,
  type BudgetRecommendationsDto,
  type CashFlowForecastDto,
  type CurrencyCode,
  type EntityId,
  type FinancialHealthDto,
  type FinancialScenarioDto,
  type ForecastHorizon,
  type ForecastIncomeBasis,
  type GoalProjectionsDto,
  type IntelligenceExplanationDto,
  type IntelligenceExplanationInput,
  type IntelligenceOverviewDto,
  type RecommendationListDto,
  type RecommendationStateDto,
  type ScenarioComparisonDto,
  type ScenarioDefinitionInput,
  type ScenarioListDto,
  type ScenarioResultDto,
  type SpendingForecastDto,
  type SpendingForecastPeriod,
  type SpendingPatternsDto,
  type UpdateScenarioInput,
} from '@calmcash/shared';
import { z } from 'zod';

import { api } from '@/lib/api';

// Financial intelligence (Phase 11): estimates, predictions, and simulations calculated by the API
// from recorded transactions and schedules. Every response is validated against the shared schema;
// nothing here records money or changes a budget, schedule, or goal.

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function scenarioPath(scenarioId: EntityId): `/${string}` {
  return `/intelligence/scenarios/${encodeURIComponent(scenarioId)}`;
}

export function getIntelligenceOverview(
  currency: CurrencyCode | undefined,
  signal?: AbortSignal,
): Promise<IntelligenceOverviewDto> {
  return api.request(`/intelligence/overview${query({ currency })}`, {
    schema: intelligenceOverviewDtoSchema,
    signal,
  });
}

export function getCashFlowForecast(
  options: {
    horizon: ForecastHorizon;
    income: ForecastIncomeBasis;
    currency?: CurrencyCode | undefined;
  },
  signal?: AbortSignal,
): Promise<CashFlowForecastDto> {
  return api.request(
    `/intelligence/cashflow-forecast${query({
      horizon: String(options.horizon),
      income: options.income,
      currency: options.currency,
    })}`,
    { schema: cashFlowForecastDtoSchema, signal },
  );
}

export function getSpendingForecast(
  options: { period: SpendingForecastPeriod; currency?: CurrencyCode | undefined },
  signal?: AbortSignal,
): Promise<SpendingForecastDto> {
  return api.request(`/intelligence/spending-forecast${query(options)}`, {
    schema: spendingForecastDtoSchema,
    signal,
  });
}

/** `search` is a spending-pattern query string without the `?` (period, from, to, currency). */
export function getSpendingPatterns(
  search: string,
  signal?: AbortSignal,
): Promise<SpendingPatternsDto> {
  return api.request(
    search === '' ? '/intelligence/spending-patterns' : `/intelligence/spending-patterns?${search}`,
    { schema: spendingPatternsDtoSchema, signal },
  );
}

export function getBudgetRecommendations(
  currency: CurrencyCode | undefined,
  signal?: AbortSignal,
): Promise<BudgetRecommendationsDto> {
  return api.request(`/intelligence/budget-recommendations${query({ currency })}`, {
    schema: budgetRecommendationsDtoSchema,
    signal,
  });
}

export function getGoalProjections(signal?: AbortSignal): Promise<GoalProjectionsDto> {
  return api.request('/intelligence/goal-projections', {
    schema: goalProjectionsDtoSchema,
    signal,
  });
}

export function getFinancialHealth(
  currency: CurrencyCode | undefined,
  signal?: AbortSignal,
): Promise<FinancialHealthDto> {
  return api.request(`/intelligence/financial-health${query({ currency })}`, {
    schema: financialHealthDtoSchema,
    signal,
  });
}

export function getRecommendations(
  currency: CurrencyCode | undefined,
  signal?: AbortSignal,
): Promise<RecommendationListDto> {
  return api.request(`/intelligence/recommendations${query({ currency })}`, {
    schema: recommendationListDtoSchema,
    signal,
  });
}

export function markRecommendation(
  key: string,
  mark: 'dismiss' | 'review',
): Promise<RecommendationStateDto> {
  return api.request(`/intelligence/recommendations/${encodeURIComponent(key)}/${mark}`, {
    schema: recommendationStateDtoSchema,
    method: 'POST',
  });
}

// --- Scenarios -----------------------------------------------------------------------------------

export function listScenarios(page = 1, signal?: AbortSignal): Promise<ScenarioListDto> {
  return api.request(`/intelligence/scenarios?page=${String(page)}`, {
    schema: scenarioListDtoSchema,
    signal,
  });
}

export function createScenario(input: ScenarioDefinitionInput): Promise<FinancialScenarioDto> {
  return api.request('/intelligence/scenarios', {
    schema: financialScenarioDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateScenario(
  scenarioId: EntityId,
  input: UpdateScenarioInput,
): Promise<FinancialScenarioDto> {
  return api.request(scenarioPath(scenarioId), {
    schema: financialScenarioDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

const deletedSchema = z.object({ deleted: z.literal(true) });

export async function deleteScenario(scenarioId: EntityId): Promise<void> {
  await api.request(scenarioPath(scenarioId), { schema: deletedSchema, method: 'DELETE' });
}

export function runScenario(scenarioId: EntityId): Promise<ScenarioResultDto> {
  return api.request(`${scenarioPath(scenarioId)}/run`, {
    schema: scenarioResultDtoSchema,
    method: 'POST',
  });
}

export function previewScenario(input: ScenarioDefinitionInput): Promise<ScenarioResultDto> {
  return api.request('/intelligence/scenarios/preview', {
    schema: scenarioResultDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function compareScenarios(scenarioIds: EntityId[]): Promise<ScenarioComparisonDto> {
  return api.request('/intelligence/scenarios/compare', {
    schema: scenarioComparisonDtoSchema,
    method: 'POST',
    body: { scenarioIds },
  });
}

// --- Explanations --------------------------------------------------------------------------------

export function explainIntelligence(
  input: IntelligenceExplanationInput,
): Promise<IntelligenceExplanationDto> {
  return api.request('/ai/intelligence-explanations', {
    schema: intelligenceExplanationDtoSchema,
    method: 'POST',
    body: input,
  });
}
