import { z } from 'zod';

import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import {
  BUDGET_HEALTH_FLAGS,
  BUDGET_SUGGESTION_BASES,
  DATA_SUFFICIENCY_LEVELS,
  DEFAULT_FORECAST_HORIZON,
  DEFAULT_SPENDING_PATTERN_PERIOD,
  FORECAST_HORIZONS,
  FORECAST_INCOME_BASES,
  FORECAST_WARNING_CODES,
  GOAL_PACE_UNAVAILABLE_REASONS,
  GOAL_PROJECTION_STATES,
  HEALTH_GROUPS,
  INTELLIGENCE_EXPLANATION_SUBJECTS,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_SOURCES,
  RECOMMENDATION_STATES,
  RECOMMENDATION_TYPES,
  SCENARIO_ADJUSTMENT_KINDS,
  SCENARIO_HORIZONS,
  SCENARIO_LIMITS,
  SPENDING_FORECAST_PERIODS,
  SPENDING_PATTERN_PERIODS,
  SPENDING_TRENDS,
} from '../constants/intelligence';
import { tryParseMinorUnits } from '../money/minor-units';
import type {
  BudgetFlagDto,
  BudgetPeriodResultDto,
  BudgetPrefillDto,
  BudgetRecommendationDto,
  BudgetRecommendationsDto,
  BudgetSuggestionDto,
  CashFlowForecastDto,
  CashFlowForecastQuery,
  CategoryEstimateDto,
  CategoryForecastDto,
  CategoryPatternDto,
  CurrencyCashFlowForecastDto,
  DataSufficiencyDto,
  DateRangeDto,
  EstimatedIncomeDto,
  FinancialHealthDto,
  FinancialRecommendationDto,
  FinancialScenarioDto,
  ForecastBucketDto,
  ForecastItemDto,
  ForecastWarningDto,
  GoalPaceDto,
  GoalProjectionDto,
  GoalProjectionsDto,
  GoalSuggestionDto,
  HealthIndicatorDto,
  IntelligenceExplanationDto,
  IntelligenceExplanationInput,
  IntelligenceOverviewDto,
  LargestExpenseDto,
  MerchantPatternDto,
  MethodologyDto,
  MonthlyAmountDto,
  MonthlyStatisticsDto,
  RecommendationListDto,
  RecommendationStateDto,
  ScenarioAdjustmentDto,
  ScenarioBudgetImpactDto,
  ScenarioChangeDto,
  ScenarioCompareInput,
  ScenarioComparisonDto,
  ScenarioDefinitionInput,
  ScenarioEffectDto,
  ScenarioGoalImpactDto,
  ScenarioGoalOutcomeDto,
  ScenarioListDto,
  ScenarioListQuery,
  ScenarioResultDto,
  ScenarioTimelinePointDto,
  ScenarioTotalsDto,
  SpendingForecastDto,
  SpendingForecastQuery,
  SpendingPatternsDto,
  SpendingPatternsQuery,
  UpdateScenarioInput,
  VariableSpendingEstimateDto,
} from '../types/intelligence';
import { assistantLinkDtoSchema, figureDtoSchema } from './ai';
import { budgetProgressStatusSchema } from './budget';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  singleLineTextSchema,
} from './common';
import { basisPointsSchema, ratioDtoSchema } from './dashboard';
import { savingsGoalStatusSchema } from './goal';
import { paginationDtoSchema } from './transaction';

// Runtime mirrors of `types/intelligence.ts`. Queries and bodies are strict (unknown fields are
// rejected); responses are validated by the web client before use.

export const dataSufficiencyLevelSchema = z.enum(DATA_SUFFICIENCY_LEVELS);
export const intelligenceKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:._-]+$/);

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const text = (max: number): z.ZodString => z.string().min(1).max(max);
const count = z.number().int().nonnegative();

/** A query-string number from a fixed list, e.g. `horizon=30`. */
function numberChoice<const T extends readonly number[]>(
  values: T,
  message: string,
): z.ZodType<T[number], string> {
  return z
    .string()
    .regex(/^\d{1,4}$/, { error: message })
    .transform((value, context) => {
      const match = values.find((candidate) => candidate === Number(value));
      if (match === undefined) {
        context.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return match;
    });
}

export const dateRangeDtoSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
}) satisfies z.ZodType<DateRangeDto>;

export const dataSufficiencyDtoSchema = z.object({
  level: dataSufficiencyLevelSchema,
  monthsConsidered: count,
  monthsWithActivity: count,
  transactionCount: count,
  firstActivityDate: isoDateSchema.exactOptional(),
  notes: z.array(text(300)).max(8),
}) satisfies z.ZodType<DataSufficiencyDto>;

export const methodologyDtoSchema = z.object({
  version: text(40),
  summary: text(1_000),
  steps: z.array(text(400)).max(20),
  assumptions: z.array(text(400)).max(20),
  limitations: z.array(text(400)).max(20),
}) satisfies z.ZodType<MethodologyDto>;

export const monthlyAmountDtoSchema = z.object({
  month: monthSchema,
  amountMinor: minorUnitsSchema,
  count,
}) satisfies z.ZodType<MonthlyAmountDto>;

export const monthlyStatisticsDtoSchema = z.object({
  months: z.array(monthlyAmountDtoSchema).max(24),
  averageMinor: minorUnitsSchema,
  medianMinor: minorUnitsSchema,
  lowestMinor: minorUnitsSchema,
  highestMinor: minorUnitsSchema,
}) satisfies z.ZodType<MonthlyStatisticsDto>;

// --- Overview ------------------------------------------------------------------------------------

export const intelligenceOverviewQuerySchema = z.strictObject({
  currency: currencyCodeSchema.exactOptional(),
});

export const intelligenceOverviewDtoSchema = z.object({
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  today: isoDateSchema,
  calculatedAt: isoDateTimeSchema,
  thisMonth: dateRangeDtoSchema,
  incomeMinor: minorUnitsSchema,
  expenseMinor: minorUnitsSchema,
  netMinor: minorUnitsSchema,
  savingsRate: ratioDtoSchema,
  heldMinor: minorUnitsSchema,
  owedMinor: minorUnitsSchema,
  lastMonth: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    incomeMinor: minorUnitsSchema,
    expenseMinor: minorUnitsSchema,
  }),
  sufficiency: dataSufficiencyDtoSchema,
}) satisfies z.ZodType<IntelligenceOverviewDto>;

// --- Cash-flow forecast --------------------------------------------------------------------------

export const forecastHorizonSchema = numberChoice(
  FORECAST_HORIZONS,
  'Choose 7, 30, 60, or 90 days.',
);

export const cashFlowForecastQuerySchema = z.strictObject({
  horizon: forecastHorizonSchema.default(DEFAULT_FORECAST_HORIZON),
  income: z.enum(FORECAST_INCOME_BASES).default('scheduled'),
  currency: currencyCodeSchema.exactOptional(),
}) satisfies z.ZodType<CashFlowForecastQuery>;

export const forecastWarningDtoSchema = z.object({
  code: z.enum(FORECAST_WARNING_CODES),
  message: text(400),
}) satisfies z.ZodType<ForecastWarningDto>;

export const forecastItemDtoSchema = z.object({
  scheduleId: entityIdSchema,
  name: text(255),
  type: z.enum(['income', 'expense']),
  isSubscription: z.boolean(),
  scheduledDate: isoDateSchema,
  dueDate: isoDateSchema,
  status: z.enum(['upcoming', 'due', 'overdue']),
  postponed: z.boolean(),
  amountMinor: minorUnitsSchema,
  counted: z.boolean(),
}) satisfies z.ZodType<ForecastItemDto>;

export const forecastBucketDtoSchema = z.object({
  start: isoDateSchema,
  end: isoDateSchema,
  scheduledIncomeMinor: minorUnitsSchema,
  scheduledExpenseMinor: minorUnitsSchema,
  estimatedIncomeMinor: minorUnitsSchema,
  estimatedVariableMinor: minorUnitsSchema,
  projectedPositionMinor: minorUnitsSchema,
}) satisfies z.ZodType<ForecastBucketDto>;

const insufficient = z.object({
  status: z.literal('unavailable'),
  reason: z.literal('insufficient_history'),
});

export const variableSpendingEstimateDtoSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    amountMinor: minorUnitsSchema,
    monthlyBaselineMinor: minorUnitsSchema,
    lowMinor: minorUnitsSchema,
    highMinor: minorUnitsSchema,
    monthsUsed: count,
  }),
  insufficient,
]) satisfies z.ZodType<VariableSpendingEstimateDto>;

export const estimatedIncomeDtoSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.enum(['included', 'excluded']),
    amountMinor: minorUnitsSchema,
    monthlyBaselineMinor: minorUnitsSchema,
    monthsUsed: count,
  }),
  insufficient,
]) satisfies z.ZodType<EstimatedIncomeDto>;

const amountCount = z.object({ amountMinor: minorUnitsSchema, count });

export const currencyCashFlowForecastDtoSchema = z.object({
  currency: currencyCodeSchema,
  sufficiency: dataSufficiencyDtoSchema,
  starting: z.object({
    heldMinor: minorUnitsSchema,
    owedMinor: minorUnitsSchema,
    netPositionMinor: minorUnitsSchema,
  }),
  monthToDate: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    incomeMinor: minorUnitsSchema,
    expenseMinor: minorUnitsSchema,
  }),
  scheduledIncome: amountCount,
  scheduledExpenses: z.object({
    amountMinor: minorUnitsSchema,
    count,
    subscriptionMinor: minorUnitsSchema,
    overdueMinor: minorUnitsSchema,
    overdueCount: count,
  }),
  overdueIncomeNotCounted: amountCount,
  variableSpending: variableSpendingEstimateDtoSchema,
  estimatedIncome: estimatedIncomeDtoSchema,
  expectedIncomeMinor: minorUnitsSchema,
  expectedExpensesMinor: minorUnitsSchema,
  projected: z.object({
    endingPositionMinor: minorUnitsSchema,
    changeMinor: minorUnitsSchema,
    lowMinor: minorUnitsSchema.exactOptional(),
    highMinor: minorUnitsSchema.exactOptional(),
  }),
  buckets: z.array(forecastBucketDtoSchema).max(100),
  items: z.array(forecastItemDtoSchema).max(100),
  itemsTruncated: z.boolean(),
  warnings: z.array(forecastWarningDtoSchema).max(20),
}) satisfies z.ZodType<CurrencyCashFlowForecastDto>;

export const cashFlowForecastDtoSchema = z.object({
  today: isoDateSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  horizonDays: z.literal(FORECAST_HORIZONS),
  timeZone: text(64),
  incomeBasis: z.enum(FORECAST_INCOME_BASES),
  calculatedAt: isoDateTimeSchema,
  availableCurrencies: z.array(currencyCodeSchema),
  forecasts: z.array(currencyCashFlowForecastDtoSchema).max(10),
  methodology: methodologyDtoSchema,
  warnings: z.array(forecastWarningDtoSchema).max(20),
}) satisfies z.ZodType<CashFlowForecastDto>;

// --- Spending predictions ------------------------------------------------------------------------

export const spendingForecastQuerySchema = z.strictObject({
  period: z.enum(SPENDING_FORECAST_PERIODS).default('this-month'),
  currency: currencyCodeSchema.exactOptional(),
}) satisfies z.ZodType<SpendingForecastQuery>;

export const categoryEstimateDtoSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    expectedRemainingMinor: minorUnitsSchema,
    estimatedPeriodEndMinor: minorUnitsSchema,
  }),
  insufficient,
]) satisfies z.ZodType<CategoryEstimateDto>;

export const categoryForecastDtoSchema = z.object({
  categoryId: entityIdSchema.exactOptional(),
  name: text(120),
  archived: z.boolean(),
  history: monthlyStatisticsDtoSchema,
  actualToDateMinor: minorUnitsSchema,
  estimate: categoryEstimateDtoSchema,
  trend: z.enum(SPENDING_TRENDS),
  observations: count,
  sufficiency: dataSufficiencyLevelSchema,
  budget: z
    .object({ budgetId: entityIdSchema, name: text(100), limitMinor: minorUnitsSchema })
    .exactOptional(),
}) satisfies z.ZodType<CategoryForecastDto>;

export const spendingForecastDtoSchema = z.object({
  period: z.enum(SPENDING_FORECAST_PERIODS),
  from: isoDateSchema,
  to: isoDateSchema,
  today: isoDateSchema,
  daysElapsed: count,
  daysInPeriod: z.number().int().positive(),
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  calculatedAt: isoDateTimeSchema,
  sufficiency: dataSufficiencyDtoSchema,
  totals: z.object({
    actualToDateMinor: minorUnitsSchema,
    expectedRemainingMinor: minorUnitsSchema,
    estimatedPeriodEndMinor: minorUnitsSchema,
  }),
  scheduledRemaining: z.object({
    amountMinor: minorUnitsSchema,
    count,
    subscriptionMinor: minorUnitsSchema,
  }),
  categories: z.array(categoryForecastDtoSchema).max(200),
  methodology: methodologyDtoSchema,
}) satisfies z.ZodType<SpendingForecastDto>;

// --- Historical spending patterns ----------------------------------------------------------------

export const spendingPatternsQuerySchema = z
  .strictObject({
    period: z.enum(SPENDING_PATTERN_PERIODS).default(DEFAULT_SPENDING_PATTERN_PERIOD),
    from: isoDateSchema.exactOptional(),
    to: isoDateSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
  })
  .superRefine((query, context) => {
    if (query.period === 'custom') {
      for (const field of ['from', 'to'] as const) {
        if (query[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'A custom period needs a start and an end date.',
          });
        }
      }
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'The end date must be on or after the start date.',
        });
      }
    } else if (query.from !== undefined || query.to !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['period'],
        message: 'Dates can only be given with the custom period.',
      });
    }
  }) satisfies z.ZodType<SpendingPatternsQuery>;

export const largestExpenseDtoSchema = z.object({
  transactionId: entityIdSchema,
  date: isoDateSchema,
  description: z.string().max(255),
  merchant: z.string().max(120).exactOptional(),
  amountMinor: minorUnitsSchema,
}) satisfies z.ZodType<LargestExpenseDto>;

export const categoryPatternDtoSchema = z.object({
  categoryId: entityIdSchema.exactOptional(),
  name: text(120),
  archived: z.boolean(),
  totalMinor: minorUnitsSchema,
  count,
  shareBasisPoints: basisPointsSchema,
  previousTotalMinor: minorUnitsSchema,
  change: ratioDtoSchema,
  shareChangeBasisPoints: basisPointsSchema,
  averageMonthlyMinor: minorUnitsSchema,
  medianMonthlyMinor: minorUnitsSchema,
  largest: largestExpenseDtoSchema.exactOptional(),
}) satisfies z.ZodType<CategoryPatternDto>;

export const merchantPatternDtoSchema = z.object({
  key: text(120),
  label: text(255),
  totalMinor: minorUnitsSchema,
  count,
  averageMinor: minorUnitsSchema,
  previousCount: count,
  previousTotalMinor: minorUnitsSchema,
  mainCategory: text(120).exactOptional(),
  shareOfCategoryBasisPoints: basisPointsSchema.exactOptional(),
  activeMonths: count,
}) satisfies z.ZodType<MerchantPatternDto>;

export const spendingPatternsDtoSchema = z.object({
  period: z.enum(SPENDING_PATTERN_PERIODS),
  from: isoDateSchema,
  to: isoDateSchema,
  comparedTo: dateRangeDtoSchema,
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  calculatedAt: isoDateTimeSchema,
  sufficiency: dataSufficiencyDtoSchema,
  totals: z.object({
    incomeMinor: minorUnitsSchema,
    expenseMinor: minorUnitsSchema,
    netMinor: minorUnitsSchema,
    incomeCount: count,
    expenseCount: count,
  }),
  distribution: z
    .object({
      averageMinor: minorUnitsSchema,
      medianMinor: minorUnitsSchema,
      lowerQuartileMinor: minorUnitsSchema,
      upperQuartileMinor: minorUnitsSchema,
      ninetiethMinor: minorUnitsSchema,
      largest: largestExpenseDtoSchema,
      smallPayments: z.object({
        thresholdMinor: minorUnitsSchema,
        count,
        totalMinor: minorUnitsSchema,
        shareBasisPoints: basisPointsSchema,
      }),
    })
    .exactOptional(),
  monthly: z
    .array(
      z.object({
        month: monthSchema,
        partial: z.boolean(),
        incomeMinor: minorUnitsSchema,
        expenseMinor: minorUnitsSchema,
        netMinor: minorUnitsSchema,
      }),
    )
    .max(40),
  weekdays: z
    .array(
      z.object({ weekday: z.number().int().min(1).max(7), expenseMinor: minorUnitsSchema, count }),
    )
    .max(7),
  categories: z.array(categoryPatternDtoSchema).max(50),
  topMerchantsBySpend: z.array(merchantPatternDtoSchema).max(20),
  topMerchantsByCount: z.array(merchantPatternDtoSchema).max(20),
  methodology: methodologyDtoSchema,
}) satisfies z.ZodType<SpendingPatternsDto>;

// --- Budget recommendations ----------------------------------------------------------------------

export const budgetRecommendationsQuerySchema = intelligenceOverviewQuerySchema;

export const budgetSuggestionDtoSchema = z.object({
  basis: z.enum(BUDGET_SUGGESTION_BASES),
  limitMinor: minorUnitsSchema,
  monthsWithin: count,
  monthsConsidered: count,
  explanation: text(400),
}) satisfies z.ZodType<BudgetSuggestionDto>;

export const budgetFlagDtoSchema = z.object({
  code: z.enum(BUDGET_HEALTH_FLAGS),
  message: text(400),
}) satisfies z.ZodType<BudgetFlagDto>;

export const budgetPeriodResultDtoSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  spentMinor: minorUnitsSchema,
  limitMinor: minorUnitsSchema,
  status: budgetProgressStatusSchema,
}) satisfies z.ZodType<BudgetPeriodResultDto>;

export const budgetPrefillDtoSchema = z.object({
  budgetId: entityIdSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  name: text(100),
  currency: currencyCodeSchema,
  period: z.literal('monthly'),
  limitMinor: minorUnitsSchema,
}) satisfies z.ZodType<BudgetPrefillDto>;

export const budgetRecommendationDtoSchema = z.object({
  key: intelligenceKeySchema,
  categoryId: entityIdSchema.exactOptional(),
  categoryName: text(120),
  currency: currencyCodeSchema,
  history: monthlyStatisticsDtoSchema,
  existingBudget: z
    .object({
      budgetId: entityIdSchema,
      name: text(100),
      limitMinor: minorUnitsSchema,
      recentPeriods: z.array(budgetPeriodResultDtoSchema).max(12),
      overCount: count,
    })
    .exactOptional(),
  suggestions: z.array(budgetSuggestionDtoSchema).max(4),
  flags: z.array(budgetFlagDtoSchema).max(8),
  sufficiency: dataSufficiencyLevelSchema,
  prefill: budgetPrefillDtoSchema,
}) satisfies z.ZodType<BudgetRecommendationDto>;

export const budgetRecommendationsDtoSchema = z.object({
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  history: dateRangeDtoSchema,
  calculatedAt: isoDateTimeSchema,
  sufficiency: dataSufficiencyDtoSchema,
  items: z.array(budgetRecommendationDtoSchema).max(100),
  methodology: methodologyDtoSchema,
}) satisfies z.ZodType<BudgetRecommendationsDto>;

// --- Savings-goal projections --------------------------------------------------------------------

export const goalPaceDtoSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    monthlyAverageMinor: minorUnitsSchema,
    monthsUsed: count,
    contributionCount: count,
  }),
  z.object({ status: z.literal('unavailable'), reason: z.enum(GOAL_PACE_UNAVAILABLE_REASONS) }),
]) satisfies z.ZodType<GoalPaceDto>;

export const goalSuggestionDtoSchema = z.object({
  kind: z.enum(['increase_contribution', 'extend_target_date', 'set_target_date']),
  text: text(400),
  amountMinor: minorUnitsSchema.exactOptional(),
  date: isoDateSchema.exactOptional(),
}) satisfies z.ZodType<GoalSuggestionDto>;

export const goalProjectionDtoSchema = z.object({
  goalId: entityIdSchema,
  name: text(100),
  currency: currencyCodeSchema,
  status: savingsGoalStatusSchema,
  savedMinor: minorUnitsSchema,
  targetMinor: minorUnitsSchema,
  remainingMinor: minorUnitsSchema,
  percent: ratioDtoSchema,
  targetDate: isoDateSchema.exactOptional(),
  requiredMonthlyMinor: minorUnitsSchema.exactOptional(),
  pace: goalPaceDtoSchema,
  projectedCompletionDate: isoDateSchema.exactOptional(),
  state: z.enum(GOAL_PROJECTION_STATES),
  recentMonths: z.array(monthlyAmountDtoSchema).max(24),
  suggestions: z.array(goalSuggestionDtoSchema).max(4),
}) satisfies z.ZodType<GoalProjectionDto>;

export const goalProjectionsDtoSchema = z.object({
  today: isoDateSchema,
  calculatedAt: isoDateTimeSchema,
  goals: z.array(goalProjectionDtoSchema).max(100),
  methodology: methodologyDtoSchema,
}) satisfies z.ZodType<GoalProjectionsDto>;

// --- Financial health ----------------------------------------------------------------------------

export const financialHealthQuerySchema = intelligenceOverviewQuerySchema;

export const healthIndicatorDtoSchema = z.object({
  key: intelligenceKeySchema,
  group: z.enum(HEALTH_GROUPS),
  title: text(120),
  definition: text(500),
  currency: currencyCodeSchema.exactOptional(),
  period: dateRangeDtoSchema.exactOptional(),
  status: z.enum(['available', 'unavailable']),
  headline: figureDtoSchema.exactOptional(),
  figures: z.array(figureDtoSchema).max(10),
  sufficiency: dataSufficiencyLevelSchema,
  unavailableReason: text(300).exactOptional(),
  link: assistantLinkDtoSchema.exactOptional(),
}) satisfies z.ZodType<HealthIndicatorDto>;

export const financialHealthDtoSchema = z.object({
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  today: isoDateSchema,
  calculatedAt: isoDateTimeSchema,
  sufficiency: dataSufficiencyDtoSchema,
  indicators: z.array(healthIndicatorDtoSchema).max(30),
  methodology: methodologyDtoSchema,
}) satisfies z.ZodType<FinancialHealthDto>;

// --- Recommendations -----------------------------------------------------------------------------

export const recommendationsQuerySchema = intelligenceOverviewQuerySchema;

export const financialRecommendationDtoSchema = z.object({
  key: intelligenceKeySchema,
  type: z.enum(RECOMMENDATION_TYPES),
  priority: z.enum(RECOMMENDATION_PRIORITIES),
  title: text(200),
  observation: text(600),
  suggestion: text(600),
  metrics: z.array(figureDtoSchema).max(8),
  currency: currencyCodeSchema,
  period: dateRangeDtoSchema.exactOptional(),
  source: z.enum(RECOMMENDATION_SOURCES),
  links: z.array(assistantLinkDtoSchema).max(4),
  createdAt: isoDateTimeSchema,
  state: z.enum(RECOMMENDATION_STATES),
  reevaluation: text(300),
  budgetPrefill: budgetPrefillDtoSchema.exactOptional(),
}) satisfies z.ZodType<FinancialRecommendationDto>;

export const recommendationListDtoSchema = z.object({
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  calculatedAt: isoDateTimeSchema,
  sufficiency: dataSufficiencyDtoSchema,
  items: z.array(financialRecommendationDtoSchema).max(30),
  dismissedCount: count,
}) satisfies z.ZodType<RecommendationListDto>;

export const recommendationStateDtoSchema = z.object({
  key: intelligenceKeySchema,
  state: z.enum(['dismissed', 'reviewed']),
}) satisfies z.ZodType<RecommendationStateDto>;

// --- Scenarios -----------------------------------------------------------------------------------

/** A hypothetical amount: positive, at most the largest amount a person may type. */
export const scenarioAmountSchema = z.string({ error: 'Enter an amount.' }).refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return parsed !== undefined && parsed > 0n && parsed <= MAX_ENTERED_AMOUNT_MINOR;
  },
  { error: 'Enter an amount above zero, in minor units.' },
);

const scenarioLabelSchema = singleLineTextSchema(SCENARIO_LIMITS.label, 'Describe this change.');
const scenarioMonthsSchema = z
  .number()
  .int()
  .min(1, { error: 'Use at least one month.' })
  .max(SCENARIO_LIMITS.maxMonths, { error: `Use at most ${SCENARIO_LIMITS.maxMonths} months.` });

export const scenarioChangeDtoSchema = z.discriminatedUnion('by', [
  z.strictObject({
    by: z.literal('percent'),
    percentBp: z
      .number()
      .int()
      .min(1, { error: 'Enter a percentage above zero.' })
      .max(SCENARIO_LIMITS.maxIncreaseBp, { error: 'Use at most 1000 %.' }),
  }),
  z.strictObject({ by: z.literal('amount'), amountMinor: scenarioAmountSchema }),
]) satisfies z.ZodType<ScenarioChangeDto>;

const directionSchema = z.enum(['decrease', 'increase']);

function decreaseWithinLimit(adjustment: {
  direction: 'decrease' | 'increase';
  change: ScenarioChangeDto;
}): boolean {
  return (
    adjustment.direction !== 'decrease' ||
    adjustment.change.by !== 'percent' ||
    adjustment.change.percentBp <= SCENARIO_LIMITS.maxDecreaseBp
  );
}

export const scenarioAdjustmentDtoSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('category_spending'),
      categoryId: entityIdSchema,
      direction: directionSchema,
      change: scenarioChangeDtoSchema,
      months: scenarioMonthsSchema.exactOptional(),
    }),
    z.strictObject({
      kind: z.literal('income_change'),
      direction: directionSchema,
      change: scenarioChangeDtoSchema,
      months: scenarioMonthsSchema.exactOptional(),
    }),
    z.strictObject({ kind: z.literal('cancel_schedule'), scheduleId: entityIdSchema }),
    z.strictObject({
      kind: z.literal('change_schedule_amount'),
      scheduleId: entityIdSchema,
      amountMinor: scenarioAmountSchema,
    }),
    z.strictObject({
      kind: z.literal('monthly_expense'),
      label: scenarioLabelSchema,
      amountMinor: scenarioAmountSchema,
      months: scenarioMonthsSchema.exactOptional(),
    }),
    z.strictObject({
      kind: z.literal('monthly_income'),
      label: scenarioLabelSchema,
      amountMinor: scenarioAmountSchema,
      months: scenarioMonthsSchema.exactOptional(),
    }),
    z.strictObject({
      kind: z.literal('one_time_expense'),
      label: scenarioLabelSchema,
      amountMinor: scenarioAmountSchema,
      date: isoDateSchema,
    }),
    z.strictObject({ kind: z.literal('debt_payment'), amountMinor: scenarioAmountSchema }),
    z.strictObject({
      kind: z.literal('goal_contribution'),
      goalId: entityIdSchema,
      monthlyAmountMinor: scenarioAmountSchema,
    }),
    z.strictObject({
      kind: z.literal('goal_target_date'),
      goalId: entityIdSchema,
      targetDate: isoDateSchema,
    }),
  ])
  .refine(
    (adjustment) =>
      (adjustment.kind !== 'category_spending' && adjustment.kind !== 'income_change') ||
      decreaseWithinLimit(adjustment),
    { error: 'A reduction can be at most 100 %.', path: ['change', 'percentBp'] },
  ) satisfies z.ZodType<ScenarioAdjustmentDto>;

export const scenarioNameSchema = singleLineTextSchema(
  SCENARIO_LIMITS.name,
  'Give this scenario a name, e.g. "Spend less on dining".',
);

export const scenarioHorizonSchema = z.literal(SCENARIO_HORIZONS, {
  error: 'Choose 30, 60, 90, 180, or 365 days.',
});

const adjustmentsSchema = z
  .array(scenarioAdjustmentDtoSchema)
  .min(1, { error: 'Add at least one change to simulate.' })
  .max(SCENARIO_LIMITS.adjustments, {
    error: `Use at most ${SCENARIO_LIMITS.adjustments} changes.`,
  });

export const scenarioDefinitionInputSchema = z.strictObject({
  name: scenarioNameSchema,
  currency: currencyCodeSchema,
  horizonDays: scenarioHorizonSchema,
  adjustments: adjustmentsSchema,
}) satisfies z.ZodType<ScenarioDefinitionInput>;

export const updateScenarioInputSchema = z
  .strictObject({
    name: scenarioNameSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
    horizonDays: scenarioHorizonSchema.exactOptional(),
    adjustments: adjustmentsSchema.exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Change at least one field.',
  }) satisfies z.ZodType<UpdateScenarioInput>;

export const financialScenarioDtoSchema = z.object({
  id: entityIdSchema,
  name: text(SCENARIO_LIMITS.name),
  currency: currencyCodeSchema,
  horizonDays: scenarioHorizonSchema,
  adjustments: z.array(scenarioAdjustmentDtoSchema).max(SCENARIO_LIMITS.adjustments),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<FinancialScenarioDto>;

export const scenarioListQuerySchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9]\d{0,3}$/, { error: 'Use a page number from 1.' })
    .transform((value) => Number(value))
    .default(1),
}) satisfies z.ZodType<ScenarioListQuery>;

export const scenarioListDtoSchema = z.object({
  items: z.array(financialScenarioDtoSchema).max(SCENARIO_LIMITS.pageSize),
  pagination: paginationDtoSchema,
}) satisfies z.ZodType<ScenarioListDto>;

export const scenarioCompareInputSchema = z.strictObject({
  scenarioIds: z
    .array(entityIdSchema)
    .min(1)
    .max(SCENARIO_LIMITS.compare, {
      error: `Compare at most ${SCENARIO_LIMITS.compare} scenarios.`,
    })
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Choose each scenario once.' }),
}) satisfies z.ZodType<ScenarioCompareInput>;

export const scenarioTotalsDtoSchema = z.object({
  startingPositionMinor: minorUnitsSchema,
  incomeMinor: minorUnitsSchema,
  expensesMinor: minorUnitsSchema,
  endingPositionMinor: minorUnitsSchema,
}) satisfies z.ZodType<ScenarioTotalsDto>;

export const scenarioEffectDtoSchema = z.object({
  index: count,
  kind: z.enum(SCENARIO_ADJUSTMENT_KINDS),
  description: text(300),
  status: z.enum(['applied', 'not_applicable']),
  reason: text(300).exactOptional(),
  positionChangeMinor: minorUnitsSchema,
}) satisfies z.ZodType<ScenarioEffectDto>;

const goalOutcomeSchema = z.object({
  requiredMonthlyMinor: minorUnitsSchema.exactOptional(),
  projectedCompletionDate: isoDateSchema.exactOptional(),
  state: z.enum(GOAL_PROJECTION_STATES),
}) satisfies z.ZodType<ScenarioGoalOutcomeDto>;

export const scenarioGoalImpactDtoSchema = z.object({
  goalId: entityIdSchema,
  name: text(100),
  baseline: goalOutcomeSchema,
  simulated: goalOutcomeSchema,
}) satisfies z.ZodType<ScenarioGoalImpactDto>;

export const scenarioBudgetImpactDtoSchema = z.object({
  budgetId: entityIdSchema,
  name: text(100),
  limitMinor: minorUnitsSchema,
  baselineMonthlyMinor: minorUnitsSchema,
  simulatedMonthlyMinor: minorUnitsSchema,
}) satisfies z.ZodType<ScenarioBudgetImpactDto>;

export const scenarioTimelinePointDtoSchema = z.object({
  date: isoDateSchema,
  baselineMinor: minorUnitsSchema,
  simulatedMinor: minorUnitsSchema,
}) satisfies z.ZodType<ScenarioTimelinePointDto>;

export const scenarioResultDtoSchema = z.object({
  scenarioId: entityIdSchema.exactOptional(),
  name: text(SCENARIO_LIMITS.name),
  currency: currencyCodeSchema,
  horizonDays: scenarioHorizonSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  calculatedAt: isoDateTimeSchema,
  recalculationPolicy: text(400),
  sufficiency: dataSufficiencyDtoSchema,
  baseline: scenarioTotalsDtoSchema,
  simulated: scenarioTotalsDtoSchema,
  differenceMinor: minorUnitsSchema,
  heldAndOwed: z
    .object({
      baselineHeldMinor: minorUnitsSchema,
      baselineOwedMinor: minorUnitsSchema,
      simulatedHeldMinor: minorUnitsSchema,
      simulatedOwedMinor: minorUnitsSchema,
    })
    .exactOptional(),
  effects: z.array(scenarioEffectDtoSchema).max(SCENARIO_LIMITS.adjustments),
  timeline: z.array(scenarioTimelinePointDtoSchema).max(60),
  goalImpacts: z.array(scenarioGoalImpactDtoSchema).max(SCENARIO_LIMITS.adjustments),
  budgetImpacts: z.array(scenarioBudgetImpactDtoSchema).max(SCENARIO_LIMITS.adjustments),
  assumptions: z.array(text(400)).max(20),
  limitations: z.array(text(400)).max(20),
}) satisfies z.ZodType<ScenarioResultDto>;

export const scenarioComparisonDtoSchema = z.object({
  results: z.array(scenarioResultDtoSchema).max(SCENARIO_LIMITS.compare),
}) satisfies z.ZodType<ScenarioComparisonDto>;

// --- AI explanations -----------------------------------------------------------------------------

export const intelligenceExplanationInputSchema = z.discriminatedUnion('subject', [
  z.strictObject({
    subject: z.literal('cashflow_forecast'),
    horizon: z.literal(FORECAST_HORIZONS).exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
  }),
  z.strictObject({
    subject: z.literal('spending_forecast'),
    currency: currencyCodeSchema.exactOptional(),
  }),
  z.strictObject({
    subject: z.literal('financial_health'),
    currency: currencyCodeSchema.exactOptional(),
  }),
  z.strictObject({
    subject: z.literal('budget_recommendations'),
    currency: currencyCodeSchema.exactOptional(),
  }),
  z.strictObject({ subject: z.literal('goal_projections') }),
  z.strictObject({
    subject: z.literal('recommendation'),
    key: intelligenceKeySchema,
    currency: currencyCodeSchema.exactOptional(),
  }),
  z.strictObject({ subject: z.literal('scenario'), scenarioId: entityIdSchema }),
]) satisfies z.ZodType<IntelligenceExplanationInput>;

export const intelligenceExplanationDtoSchema = z.object({
  subject: z.enum(INTELLIGENCE_EXPLANATION_SUBJECTS),
  explanation: text(1_200),
  narrative: z.enum(['assistant', 'template']),
  facts: z.array(text(400)).max(60),
  calculatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<IntelligenceExplanationDto>;
