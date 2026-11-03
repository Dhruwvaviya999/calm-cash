import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import {
  completedMonths,
  monthsInRange,
  patternRange,
  precedingRange,
} from '../analytics/intelligence-periods';
import type {
  BudgetRecommendationsDto,
  CashFlowForecastDto,
  CashFlowForecastQuery,
  FinancialHealthDto,
  FinancialScenarioDto,
  GoalProjectionsDto,
  IntelligenceExplanationDto,
  IntelligenceExplanationInput,
  IntelligenceOverviewDto,
  RecommendationListDto,
  RecommendationStateDto,
  ScenarioAdjustmentDto,
  ScenarioCompareInput,
  ScenarioComparisonDto,
  ScenarioDefinitionInput,
  ScenarioListDto,
  ScenarioListQuery,
  ScenarioResultDto,
  SpendingForecastDto,
  SpendingForecastQuery,
  SpendingPatternsDto,
  SpendingPatternsQuery,
  UpdateScenarioInput,
} from '../types/intelligence';
import type {
  budgetRecommendationsDtoSchema,
  cashFlowForecastDtoSchema,
  financialHealthDtoSchema,
  financialScenarioDtoSchema,
  goalProjectionsDtoSchema,
  intelligenceExplanationDtoSchema,
  intelligenceExplanationInputSchema,
  intelligenceOverviewDtoSchema,
  recommendationListDtoSchema,
  recommendationStateDtoSchema,
  scenarioAdjustmentDtoSchema,
  scenarioComparisonDtoSchema,
  scenarioListDtoSchema,
  scenarioListQuerySchema,
  scenarioResultDtoSchema,
  spendingForecastDtoSchema,
  spendingForecastQuerySchema,
  spendingPatternsDtoSchema,
} from './intelligence';
import {
  cashFlowForecastQuerySchema,
  scenarioCompareInputSchema,
  scenarioDefinitionInputSchema,
  spendingPatternsQuerySchema,
  updateScenarioInputSchema,
} from './intelligence';

const CATEGORY = '0190a1b2-0000-7000-8000-000000000001';

describe('financial intelligence contracts', () => {
  it('keeps every schema identical to its interface', () => {
    expectTypeOf<
      z.output<typeof intelligenceOverviewDtoSchema>
    >().toEqualTypeOf<IntelligenceOverviewDto>();
    expectTypeOf<
      z.output<typeof cashFlowForecastQuerySchema>
    >().toEqualTypeOf<CashFlowForecastQuery>();
    expectTypeOf<z.output<typeof cashFlowForecastDtoSchema>>().toEqualTypeOf<CashFlowForecastDto>();
    expectTypeOf<
      z.output<typeof spendingForecastQuerySchema>
    >().toEqualTypeOf<SpendingForecastQuery>();
    expectTypeOf<z.output<typeof spendingForecastDtoSchema>>().toEqualTypeOf<SpendingForecastDto>();
    expectTypeOf<
      z.output<typeof spendingPatternsQuerySchema>
    >().toEqualTypeOf<SpendingPatternsQuery>();
    expectTypeOf<z.output<typeof spendingPatternsDtoSchema>>().toEqualTypeOf<SpendingPatternsDto>();
    expectTypeOf<
      z.output<typeof budgetRecommendationsDtoSchema>
    >().toEqualTypeOf<BudgetRecommendationsDto>();
    expectTypeOf<z.output<typeof goalProjectionsDtoSchema>>().toEqualTypeOf<GoalProjectionsDto>();
    expectTypeOf<z.output<typeof financialHealthDtoSchema>>().toEqualTypeOf<FinancialHealthDto>();
    expectTypeOf<
      z.output<typeof recommendationListDtoSchema>
    >().toEqualTypeOf<RecommendationListDto>();
    expectTypeOf<
      z.output<typeof recommendationStateDtoSchema>
    >().toEqualTypeOf<RecommendationStateDto>();
    expectTypeOf<
      z.output<typeof scenarioAdjustmentDtoSchema>
    >().toEqualTypeOf<ScenarioAdjustmentDto>();
    expectTypeOf<
      z.output<typeof scenarioDefinitionInputSchema>
    >().toEqualTypeOf<ScenarioDefinitionInput>();
    expectTypeOf<z.output<typeof updateScenarioInputSchema>>().toEqualTypeOf<UpdateScenarioInput>();
    expectTypeOf<
      z.output<typeof financialScenarioDtoSchema>
    >().toEqualTypeOf<FinancialScenarioDto>();
    expectTypeOf<z.output<typeof scenarioListQuerySchema>>().toEqualTypeOf<ScenarioListQuery>();
    expectTypeOf<z.output<typeof scenarioListDtoSchema>>().toEqualTypeOf<ScenarioListDto>();
    expectTypeOf<
      z.output<typeof scenarioCompareInputSchema>
    >().toEqualTypeOf<ScenarioCompareInput>();
    expectTypeOf<z.output<typeof scenarioResultDtoSchema>>().toEqualTypeOf<ScenarioResultDto>();
    expectTypeOf<
      z.output<typeof scenarioComparisonDtoSchema>
    >().toEqualTypeOf<ScenarioComparisonDto>();
    expectTypeOf<
      z.output<typeof intelligenceExplanationInputSchema>
    >().toEqualTypeOf<IntelligenceExplanationInput>();
    expectTypeOf<
      z.output<typeof intelligenceExplanationDtoSchema>
    >().toEqualTypeOf<IntelligenceExplanationDto>();
  });

  it('reads forecast queries from the URL with bounded horizons', () => {
    expect(cashFlowForecastQuerySchema.parse({})).toEqual({ horizon: 30, income: 'scheduled' });
    expect(cashFlowForecastQuerySchema.parse({ horizon: '90', currency: 'INR' })).toEqual({
      horizon: 90,
      income: 'scheduled',
      currency: 'INR',
    });
    for (const horizon of ['0', '45', '365', '7.5', '-7', 'abc']) {
      expect(cashFlowForecastQuerySchema.safeParse({ horizon }).success, horizon).toBe(false);
    }
    expect(cashFlowForecastQuerySchema.safeParse({ userId: CATEGORY }).success).toBe(false);
  });

  it('requires both dates for a custom pattern period and none for presets', () => {
    expect(
      spendingPatternsQuerySchema.safeParse({ period: 'custom', from: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      spendingPatternsQuerySchema.safeParse({ period: 'last-30-days', from: '2026-01-01' }).success,
    ).toBe(false);
    expect(spendingPatternsQuerySchema.parse({})).toEqual({ period: 'last-90-days' });
  });

  it('accepts only clear, bounded scenario assumptions', () => {
    const valid = {
      name: 'Less dining',
      currency: 'INR',
      horizonDays: 90,
      adjustments: [
        {
          kind: 'category_spending',
          categoryId: CATEGORY,
          direction: 'decrease',
          change: { by: 'percent', percentBp: 1500 },
        },
      ],
    };
    expect(scenarioDefinitionInputSchema.parse(valid)).toEqual(valid);
    const withAdjustment = (adjustment: Record<string, unknown>): boolean =>
      scenarioDefinitionInputSchema.safeParse({ ...valid, adjustments: [adjustment] }).success;
    // More than everything cannot be removed; zero and negative changes are not changes.
    expect(
      withAdjustment({
        kind: 'category_spending',
        categoryId: CATEGORY,
        direction: 'decrease',
        change: { by: 'percent', percentBp: 10_001 },
      }),
    ).toBe(false);
    expect(
      withAdjustment({
        kind: 'category_spending',
        categoryId: CATEGORY,
        direction: 'increase',
        change: { by: 'percent', percentBp: 20_000 },
      }),
    ).toBe(true);
    expect(withAdjustment({ kind: 'monthly_expense', label: 'Rent rise', amountMinor: '0' })).toBe(
      false,
    );
    expect(withAdjustment({ kind: 'monthly_expense', label: 'Rent rise', amountMinor: '-5' })).toBe(
      false,
    );
    expect(
      withAdjustment({ kind: 'monthly_expense', label: 'Huge', amountMinor: '9999999999999999' }),
    ).toBe(false);
    expect(withAdjustment({ kind: 'debt_payment', amountMinor: '2000000' })).toBe(true);
    expect(withAdjustment({ kind: 'unknown', amountMinor: '1' })).toBe(false);
    expect(scenarioDefinitionInputSchema.safeParse({ ...valid, horizonDays: 45 }).success).toBe(
      false,
    );
    expect(scenarioDefinitionInputSchema.safeParse({ ...valid, adjustments: [] }).success).toBe(
      false,
    );
    expect(updateScenarioInputSchema.safeParse({}).success).toBe(false);
    expect(
      scenarioCompareInputSchema.safeParse({ scenarioIds: [CATEGORY, CATEGORY] }).success,
    ).toBe(false);
  });
});

describe('intelligence periods', () => {
  it('lists completed months before the running one, across a year boundary', () => {
    expect(completedMonths('2026-02-14', 3)).toEqual([
      { from: '2025-11-01', to: '2025-11-30' },
      { from: '2025-12-01', to: '2025-12-31' },
      { from: '2026-01-01', to: '2026-01-31' },
    ]);
    // Leap year: February 2024 has 29 days.
    expect(completedMonths('2024-03-01', 1)).toEqual([{ from: '2024-02-01', to: '2024-02-29' }]);
  });

  it('resolves rolling and calendar presets against today', () => {
    expect(patternRange('last-30-days', '2026-03-01')).toEqual({
      from: '2026-01-31',
      to: '2026-03-01',
    });
    expect(patternRange('last-year', '2026-03-01')).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(patternRange('last-12-months', '2026-03-15')).toEqual({
      from: '2025-04-01',
      to: '2026-03-15',
    });
    expect(precedingRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-01-29',
      to: '2026-02-28',
    });
  });

  it('marks months the range covers only in part', () => {
    expect(monthsInRange({ from: '2026-01-15', to: '2026-03-31' })).toEqual([
      { month: '2026-01', from: '2026-01-15', to: '2026-01-31', partial: true },
      { month: '2026-02', from: '2026-02-01', to: '2026-02-28', partial: false },
      { month: '2026-03', from: '2026-03-01', to: '2026-03-31', partial: false },
    ]);
  });
});
