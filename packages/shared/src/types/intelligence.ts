import type { CurrencyCode } from '../constants/currencies';
import type {
  BudgetHealthFlag,
  BudgetSuggestionBasis,
  DataSufficiencyLevel,
  ForecastHorizon,
  ForecastIncomeBasis,
  ForecastWarningCode,
  GoalPaceUnavailableReason,
  GoalProjectionState,
  HealthGroup,
  IntelligenceExplanationSubject,
  RecommendationPriority,
  RecommendationSource,
  RecommendationState,
  RecommendationType,
  ScenarioHorizon,
  SpendingForecastPeriod,
  SpendingPatternPeriod,
  SpendingTrend,
} from '../constants/intelligence';
import type { BudgetProgressStatus, SavingsGoalStatus } from '../constants/planning';
import type { AssistantLinkDto, FigureDto } from './ai';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';
import type { RatioDto } from './dashboard';
import type { PaginationDto } from './transaction';

// Financial intelligence (Phase 11). Three kinds of figures, never mixed and always labelled:
// *actual* (recorded transactions and balances), *scheduled* (pending occurrences of confirmed
// recurring schedules), and *estimated* (statistics of completed past months). Every amount is in
// exactly one currency; currencies are never added together. Results are recalculated from the
// ledger on every request and carry the time they were calculated.

// --- Common parts --------------------------------------------------------------------------------

/** A calendar month as `YYYY-MM`. */
export type IsoMonthString = string;

export interface DateRangeDto {
  from: IsoDateString;
  to: IsoDateString;
}

/** How much history an estimate stands on, with the measured facts behind the level. */
export interface DataSufficiencyDto {
  level: DataSufficiencyLevel;
  /** Completed calendar months looked at (at most six). */
  monthsConsidered: number;
  /** Of those, months with at least one recorded expense in the currency. */
  monthsWithActivity: number;
  /** Income and expenses recorded in those months. */
  transactionCount: number;
  /** The first day with recorded income or spending in the currency, if any. */
  firstActivityDate?: IsoDateString;
  /** Why the level is not higher, in plain words. */
  notes: string[];
}

/** The documented method behind a result. */
export interface MethodologyDto {
  version: string;
  summary: string;
  /** Formulas and steps, one per line. */
  steps: string[];
  assumptions: string[];
  limitations: string[];
}

/** Total of one calendar month (completed unless stated). */
export interface MonthlyAmountDto {
  month: IsoMonthString;
  amountMinor: MinorUnitsString;
  count: number;
}

/** Statistics of monthly totals over completed months. */
export interface MonthlyStatisticsDto {
  months: MonthlyAmountDto[];
  /** Mean of the monthly totals (rounded to the minor unit). */
  averageMinor: MinorUnitsString;
  medianMinor: MinorUnitsString;
  lowestMinor: MinorUnitsString;
  highestMinor: MinorUnitsString;
}

// --- Overview ------------------------------------------------------------------------------------

export interface IntelligenceOverviewDto {
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  today: IsoDateString;
  calculatedAt: IsoDateTimeString;
  /** Actual: this calendar month so far. */
  thisMonth: { from: IsoDateString; to: IsoDateString };
  incomeMinor: MinorUnitsString;
  expenseMinor: MinorUnitsString;
  netMinor: MinorUnitsString;
  savingsRate: RatioDto;
  /** Actual, now: active accounts in this currency. */
  heldMinor: MinorUnitsString;
  owedMinor: MinorUnitsString;
  /** Actual: the last completed month, for context. */
  lastMonth: {
    from: IsoDateString;
    to: IsoDateString;
    incomeMinor: MinorUnitsString;
    expenseMinor: MinorUnitsString;
  };
  sufficiency: DataSufficiencyDto;
}

// --- Cash-flow forecast --------------------------------------------------------------------------

export interface ForecastWarningDto {
  code: ForecastWarningCode;
  message: string;
}

/** A scheduled occurrence the forecast includes (or reports without counting). */
export interface ForecastItemDto {
  scheduleId: EntityId;
  name: string;
  type: 'income' | 'expense';
  isSubscription: boolean;
  scheduledDate: IsoDateString;
  dueDate: IsoDateString;
  status: 'upcoming' | 'due' | 'overdue';
  postponed: boolean;
  amountMinor: MinorUnitsString;
  /** False for overdue income, which is reported but not assumed to arrive. */
  counted: boolean;
}

export interface ForecastBucketDto {
  start: IsoDateString;
  end: IsoDateString;
  scheduledIncomeMinor: MinorUnitsString;
  scheduledExpenseMinor: MinorUnitsString;
  estimatedIncomeMinor: MinorUnitsString;
  estimatedVariableMinor: MinorUnitsString;
  /** Projected net position at the end of the bucket. */
  projectedPositionMinor: MinorUnitsString;
}

export type VariableSpendingEstimateDto =
  | {
      status: 'available';
      /** Over the whole horizon. */
      amountMinor: MinorUnitsString;
      /** Median of the completed months' unscheduled spending. */
      monthlyBaselineMinor: MinorUnitsString;
      /** The same horizon at the lowest and highest completed month (not a confidence interval). */
      lowMinor: MinorUnitsString;
      highMinor: MinorUnitsString;
      monthsUsed: number;
    }
  | { status: 'unavailable'; reason: 'insufficient_history' };

export type EstimatedIncomeDto =
  | {
      status: 'included' | 'excluded';
      /** Over the whole horizon (counted only when `included`). */
      amountMinor: MinorUnitsString;
      /** Median of the completed months' income without a schedule. */
      monthlyBaselineMinor: MinorUnitsString;
      monthsUsed: number;
    }
  | { status: 'unavailable'; reason: 'insufficient_history' };

export interface CurrencyCashFlowForecastDto {
  currency: CurrencyCode;
  sufficiency: DataSufficiencyDto;
  /** Actual, now: active accounts in this currency. */
  starting: {
    heldMinor: MinorUnitsString;
    owedMinor: MinorUnitsString;
    /** Held − owed. */
    netPositionMinor: MinorUnitsString;
  };
  /** Actual: income and spending already recorded this calendar month. */
  monthToDate: {
    from: IsoDateString;
    to: IsoDateString;
    incomeMinor: MinorUnitsString;
    expenseMinor: MinorUnitsString;
  };
  /** Scheduled: pending income occurrences due within the horizon. */
  scheduledIncome: { amountMinor: MinorUnitsString; count: number };
  /** Scheduled: pending expense occurrences due within the horizon, plus overdue ones. */
  scheduledExpenses: {
    amountMinor: MinorUnitsString;
    count: number;
    subscriptionMinor: MinorUnitsString;
    overdueMinor: MinorUnitsString;
    overdueCount: number;
  };
  /** Overdue income is reported but never assumed to arrive. */
  overdueIncomeNotCounted: { amountMinor: MinorUnitsString; count: number };
  variableSpending: VariableSpendingEstimateDto;
  estimatedIncome: EstimatedIncomeDto;
  /** Totals the projection counts. */
  expectedIncomeMinor: MinorUnitsString;
  expectedExpensesMinor: MinorUnitsString;
  projected: {
    /** Starting net position + expected income − expected expenses. An estimate, not a balance. */
    endingPositionMinor: MinorUnitsString;
    changeMinor: MinorUnitsString;
    /** With variable spending at the highest and lowest completed month (when estimated). */
    lowMinor?: MinorUnitsString;
    highMinor?: MinorUnitsString;
  };
  buckets: ForecastBucketDto[];
  items: ForecastItemDto[];
  itemsTruncated: boolean;
  warnings: ForecastWarningDto[];
}

export interface CashFlowForecastQuery {
  horizon: ForecastHorizon;
  income: ForecastIncomeBasis;
  currency?: CurrencyCode;
}

export interface CashFlowForecastDto {
  today: IsoDateString;
  /** Tomorrow through `to`: today's recorded activity is already in the starting position. */
  from: IsoDateString;
  to: IsoDateString;
  horizonDays: ForecastHorizon;
  timeZone: string;
  incomeBasis: ForecastIncomeBasis;
  calculatedAt: IsoDateTimeString;
  /** Currencies the person holds accounts or schedules in (preferred first). */
  availableCurrencies: CurrencyCode[];
  forecasts: CurrencyCashFlowForecastDto[];
  methodology: MethodologyDto;
  warnings: ForecastWarningDto[];
}

// --- Spending predictions ------------------------------------------------------------------------

export type CategoryEstimateDto =
  | {
      status: 'available';
      /** Estimated: the typical month, spread over the days still to come. */
      expectedRemainingMinor: MinorUnitsString;
      /** Actual so far + expected remaining. */
      estimatedPeriodEndMinor: MinorUnitsString;
    }
  | { status: 'unavailable'; reason: 'insufficient_history' };

export interface CategoryForecastDto {
  /** Absent for expenses without a category. */
  categoryId?: EntityId;
  name: string;
  archived: boolean;
  history: MonthlyStatisticsDto;
  /** Actual: recorded in the period so far (0 for next month). */
  actualToDateMinor: MinorUnitsString;
  estimate: CategoryEstimateDto;
  trend: SpendingTrend;
  /** Expenses behind the history. */
  observations: number;
  sufficiency: DataSufficiencyLevel;
  /** The current monthly budget of this category in this currency, for comparison only. */
  budget?: { budgetId: EntityId; name: string; limitMinor: MinorUnitsString };
}

export interface SpendingForecastQuery {
  period: SpendingForecastPeriod;
  currency?: CurrencyCode;
}

export interface SpendingForecastDto {
  period: SpendingForecastPeriod;
  from: IsoDateString;
  to: IsoDateString;
  today: IsoDateString;
  /** Days of the period up to and including today (0 for next month). */
  daysElapsed: number;
  daysInPeriod: number;
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  calculatedAt: IsoDateTimeString;
  sufficiency: DataSufficiencyDto;
  totals: {
    actualToDateMinor: MinorUnitsString;
    expectedRemainingMinor: MinorUnitsString;
    estimatedPeriodEndMinor: MinorUnitsString;
  };
  /** Scheduled: expense occurrences still pending in the rest of the period (information only). */
  scheduledRemaining: {
    amountMinor: MinorUnitsString;
    count: number;
    subscriptionMinor: MinorUnitsString;
  };
  categories: CategoryForecastDto[];
  methodology: MethodologyDto;
}

// --- Historical spending patterns ----------------------------------------------------------------

export interface SpendingPatternsQuery {
  period: SpendingPatternPeriod;
  from?: IsoDateString;
  to?: IsoDateString;
  currency?: CurrencyCode;
}

export interface LargestExpenseDto {
  transactionId: EntityId;
  date: IsoDateString;
  description: string;
  merchant?: string;
  amountMinor: MinorUnitsString;
}

export interface CategoryPatternDto {
  categoryId?: EntityId;
  name: string;
  archived: boolean;
  totalMinor: MinorUnitsString;
  count: number;
  /** Share of the period's spending. */
  shareBasisPoints: string;
  /** Same-length period immediately before. */
  previousTotalMinor: MinorUnitsString;
  change: RatioDto;
  /** Change of the share of spending, in basis points (percentage points × 100). */
  shareChangeBasisPoints: string;
  /** Per completed or partial calendar month in the period. */
  averageMonthlyMinor: MinorUnitsString;
  medianMonthlyMinor: MinorUnitsString;
  largest?: LargestExpenseDto;
}

export interface MerchantPatternDto {
  /** Grouping key (lower-case words of the merchant or description); not a verified identity. */
  key: string;
  label: string;
  totalMinor: MinorUnitsString;
  count: number;
  averageMinor: MinorUnitsString;
  previousCount: number;
  previousTotalMinor: MinorUnitsString;
  /** The category most of its spending is in, and the merchant's share of that category. */
  mainCategory?: string;
  shareOfCategoryBasisPoints?: string;
  /** Distinct calendar months with a payment in the period. */
  activeMonths: number;
}

export interface SpendingPatternsDto {
  period: SpendingPatternPeriod;
  from: IsoDateString;
  to: IsoDateString;
  comparedTo: DateRangeDto;
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  calculatedAt: IsoDateTimeString;
  sufficiency: DataSufficiencyDto;
  totals: {
    incomeMinor: MinorUnitsString;
    expenseMinor: MinorUnitsString;
    netMinor: MinorUnitsString;
    incomeCount: number;
    expenseCount: number;
  };
  /** Absent when the period has no expenses. */
  distribution?: {
    averageMinor: MinorUnitsString;
    medianMinor: MinorUnitsString;
    lowerQuartileMinor: MinorUnitsString;
    upperQuartileMinor: MinorUnitsString;
    ninetiethMinor: MinorUnitsString;
    largest: LargestExpenseDto;
    /** Expenses at or below the lower quartile. */
    smallPayments: {
      thresholdMinor: MinorUnitsString;
      count: number;
      totalMinor: MinorUnitsString;
      shareBasisPoints: string;
    };
  };
  monthly: {
    month: IsoMonthString;
    partial: boolean;
    incomeMinor: MinorUnitsString;
    expenseMinor: MinorUnitsString;
    netMinor: MinorUnitsString;
  }[];
  /** ISO weekday (1 = Monday) in the person's time zone. */
  weekdays: { weekday: number; expenseMinor: MinorUnitsString; count: number }[];
  categories: CategoryPatternDto[];
  topMerchantsBySpend: MerchantPatternDto[];
  topMerchantsByCount: MerchantPatternDto[];
  methodology: MethodologyDto;
}

// --- Budget recommendations ----------------------------------------------------------------------

export interface BudgetSuggestionDto {
  basis: BudgetSuggestionBasis;
  /** Rounded up to a whole unit step (documented in the methodology). */
  limitMinor: MinorUnitsString;
  /** Completed months whose spending stayed within the suggestion. */
  monthsWithin: number;
  monthsConsidered: number;
  explanation: string;
}

export interface BudgetFlagDto {
  code: BudgetHealthFlag;
  message: string;
}

export interface BudgetPeriodResultDto {
  from: IsoDateString;
  to: IsoDateString;
  spentMinor: MinorUnitsString;
  limitMinor: MinorUnitsString;
  status: BudgetProgressStatus;
}

/** Values for the ordinary budget form; nothing is saved until the person saves it. */
export interface BudgetPrefillDto {
  /** Present to edit this budget; absent to create one. */
  budgetId?: EntityId;
  categoryId?: EntityId;
  name: string;
  currency: CurrencyCode;
  period: 'monthly';
  limitMinor: MinorUnitsString;
}

export interface BudgetRecommendationDto {
  key: string;
  /** Absent for the all-spending view. */
  categoryId?: EntityId;
  categoryName: string;
  currency: CurrencyCode;
  history: MonthlyStatisticsDto;
  existingBudget?: {
    budgetId: EntityId;
    name: string;
    limitMinor: MinorUnitsString;
    recentPeriods: BudgetPeriodResultDto[];
    overCount: number;
  };
  suggestions: BudgetSuggestionDto[];
  flags: BudgetFlagDto[];
  sufficiency: DataSufficiencyLevel;
  prefill: BudgetPrefillDto;
}

export interface BudgetRecommendationsDto {
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  /** The completed months the history covers. */
  history: DateRangeDto;
  calculatedAt: IsoDateTimeString;
  sufficiency: DataSufficiencyDto;
  items: BudgetRecommendationDto[];
  methodology: MethodologyDto;
}

// --- Savings-goal projections --------------------------------------------------------------------

export type GoalPaceDto =
  | {
      status: 'available';
      /** Net allocations per month over the months used (rounded down). */
      monthlyAverageMinor: MinorUnitsString;
      monthsUsed: number;
      contributionCount: number;
    }
  | { status: 'unavailable'; reason: GoalPaceUnavailableReason };

export interface GoalSuggestionDto {
  kind: 'increase_contribution' | 'extend_target_date' | 'set_target_date';
  text: string;
  amountMinor?: MinorUnitsString;
  date?: IsoDateString;
}

export interface GoalProjectionDto {
  goalId: EntityId;
  name: string;
  currency: CurrencyCode;
  status: SavingsGoalStatus;
  savedMinor: MinorUnitsString;
  targetMinor: MinorUnitsString;
  remainingMinor: MinorUnitsString;
  percent: RatioDto;
  targetDate?: IsoDateString;
  /** Present while the target date is ahead and money is still needed (whole months, rounded up). */
  requiredMonthlyMinor?: MinorUnitsString;
  pace: GoalPaceDto;
  /** Estimated from the pace; absent without a usable pace. Never a promise. */
  projectedCompletionDate?: IsoDateString;
  state: GoalProjectionState;
  /** Net allocations per completed month, oldest first. */
  recentMonths: MonthlyAmountDto[];
  suggestions: GoalSuggestionDto[];
}

export interface GoalProjectionsDto {
  today: IsoDateString;
  calculatedAt: IsoDateTimeString;
  goals: GoalProjectionDto[];
  methodology: MethodologyDto;
}

// --- Financial health ----------------------------------------------------------------------------

export interface HealthIndicatorDto {
  key: string;
  group: HealthGroup;
  title: string;
  /** How it is calculated, in plain words. */
  definition: string;
  currency?: CurrencyCode;
  period?: DateRangeDto;
  status: 'available' | 'unavailable';
  /** The main value (absent when unavailable). */
  headline?: FigureDto;
  /** The values it is calculated from. */
  figures: FigureDto[];
  sufficiency: DataSufficiencyLevel;
  unavailableReason?: string;
  link?: AssistantLinkDto;
}

export interface FinancialHealthDto {
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  today: IsoDateString;
  calculatedAt: IsoDateTimeString;
  sufficiency: DataSufficiencyDto;
  indicators: HealthIndicatorDto[];
  methodology: MethodologyDto;
}

// --- Recommendations -----------------------------------------------------------------------------

export interface FinancialRecommendationDto {
  key: string;
  type: RecommendationType;
  priority: RecommendationPriority;
  title: string;
  /** What the records show (fact). */
  observation: string;
  /** What the person could consider (advice, never a guarantee). */
  suggestion: string;
  metrics: FigureDto[];
  currency: CurrencyCode;
  period?: DateRangeDto;
  source: RecommendationSource;
  links: AssistantLinkDto[];
  /** When it was worked out (now: recommendations are recalculated on every request). */
  createdAt: IsoDateTimeString;
  state: RecommendationState;
  /** When the subject changes and the recommendation is looked at again. */
  reevaluation: string;
  /** Opens the ordinary budget form with these values (never saved automatically). */
  budgetPrefill?: BudgetPrefillDto;
}

export interface RecommendationListDto {
  currency: CurrencyCode;
  currencies: CurrencyCode[];
  calculatedAt: IsoDateTimeString;
  sufficiency: DataSufficiencyDto;
  items: FinancialRecommendationDto[];
  /** Hidden because the person dismissed them. */
  dismissedCount: number;
}

export interface RecommendationStateDto {
  key: string;
  state: 'dismissed' | 'reviewed';
}

// --- Scenarios -----------------------------------------------------------------------------------

/** A change by a percentage (basis points) or by an amount per month. */
export type ScenarioChangeDto =
  { by: 'percent'; percentBp: number } | { by: 'amount'; amountMinor: MinorUnitsString };

export type ScenarioAdjustmentDto =
  | {
      kind: 'category_spending';
      categoryId: EntityId;
      direction: 'decrease' | 'increase';
      change: ScenarioChangeDto;
      /** Applies for this many months from tomorrow (the whole horizon when absent). */
      months?: number;
    }
  | {
      /** Percent: of the scheduled income; amount: per month. */
      kind: 'income_change';
      direction: 'decrease' | 'increase';
      change: ScenarioChangeDto;
      months?: number;
    }
  | { kind: 'cancel_schedule'; scheduleId: EntityId }
  | { kind: 'change_schedule_amount'; scheduleId: EntityId; amountMinor: MinorUnitsString }
  | { kind: 'monthly_expense'; label: string; amountMinor: MinorUnitsString; months?: number }
  | { kind: 'monthly_income'; label: string; amountMinor: MinorUnitsString; months?: number }
  | { kind: 'one_time_expense'; label: string; amountMinor: MinorUnitsString; date: IsoDateString }
  /** Paying a card or loan from money held: both fall, the net position does not change. */
  | { kind: 'debt_payment'; amountMinor: MinorUnitsString }
  | { kind: 'goal_contribution'; goalId: EntityId; monthlyAmountMinor: MinorUnitsString }
  | { kind: 'goal_target_date'; goalId: EntityId; targetDate: IsoDateString };

export interface ScenarioDefinitionInput {
  name: string;
  currency: CurrencyCode;
  horizonDays: ScenarioHorizon;
  adjustments: ScenarioAdjustmentDto[];
}

export type UpdateScenarioInput = Partial<ScenarioDefinitionInput>;

/** A saved scenario: assumptions only. Results are recalculated whenever it runs. */
export interface FinancialScenarioDto extends ScenarioDefinitionInput {
  id: EntityId;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface ScenarioListQuery {
  page: number;
}

export interface ScenarioListDto {
  items: FinancialScenarioDto[];
  pagination: PaginationDto;
}

export interface ScenarioCompareInput {
  scenarioIds: EntityId[];
}

export interface ScenarioTotalsDto {
  startingPositionMinor: MinorUnitsString;
  incomeMinor: MinorUnitsString;
  expensesMinor: MinorUnitsString;
  endingPositionMinor: MinorUnitsString;
}

export interface ScenarioEffectDto {
  /** Position of the adjustment in the scenario. */
  index: number;
  kind: ScenarioAdjustmentDto['kind'];
  description: string;
  status: 'applied' | 'not_applicable';
  reason?: string;
  /** Effect on the projected net position at the end of the horizon (0 for planning-only ones). */
  positionChangeMinor: MinorUnitsString;
}

export interface ScenarioGoalOutcomeDto {
  requiredMonthlyMinor?: MinorUnitsString;
  projectedCompletionDate?: IsoDateString;
  state: GoalProjectionState;
}

export interface ScenarioGoalImpactDto {
  goalId: EntityId;
  name: string;
  baseline: ScenarioGoalOutcomeDto;
  simulated: ScenarioGoalOutcomeDto;
}

export interface ScenarioBudgetImpactDto {
  budgetId: EntityId;
  name: string;
  limitMinor: MinorUnitsString;
  /** Estimated monthly spending of the budget's category, before and with the scenario. */
  baselineMonthlyMinor: MinorUnitsString;
  simulatedMonthlyMinor: MinorUnitsString;
}

export interface ScenarioTimelinePointDto {
  date: IsoDateString;
  baselineMinor: MinorUnitsString;
  simulatedMinor: MinorUnitsString;
}

export interface ScenarioResultDto {
  /** Absent for a scenario that has not been saved. */
  scenarioId?: EntityId;
  name: string;
  currency: CurrencyCode;
  horizonDays: ScenarioHorizon;
  from: IsoDateString;
  to: IsoDateString;
  calculatedAt: IsoDateTimeString;
  /** How the result relates to the records (it is recalculated, never stored). */
  recalculationPolicy: string;
  sufficiency: DataSufficiencyDto;
  baseline: ScenarioTotalsDto;
  simulated: ScenarioTotalsDto;
  /** Simulated − baseline ending position. */
  differenceMinor: MinorUnitsString;
  /** Present when a debt payment moves money held and money owed. */
  heldAndOwed?: {
    baselineHeldMinor: MinorUnitsString;
    baselineOwedMinor: MinorUnitsString;
    simulatedHeldMinor: MinorUnitsString;
    simulatedOwedMinor: MinorUnitsString;
  };
  effects: ScenarioEffectDto[];
  timeline: ScenarioTimelinePointDto[];
  goalImpacts: ScenarioGoalImpactDto[];
  budgetImpacts: ScenarioBudgetImpactDto[];
  assumptions: string[];
  limitations: string[];
}

export interface ScenarioComparisonDto {
  results: ScenarioResultDto[];
}

// --- AI explanations -----------------------------------------------------------------------------

export type IntelligenceExplanationInput =
  | { subject: 'cashflow_forecast'; horizon?: ForecastHorizon; currency?: CurrencyCode }
  | { subject: 'spending_forecast'; currency?: CurrencyCode }
  | { subject: 'financial_health'; currency?: CurrencyCode }
  | { subject: 'budget_recommendations'; currency?: CurrencyCode }
  | { subject: 'goal_projections' }
  | { subject: 'recommendation'; key: string; currency?: CurrencyCode }
  | { subject: 'scenario'; scenarioId: EntityId };

export interface IntelligenceExplanationDto {
  subject: IntelligenceExplanationSubject;
  explanation: string;
  narrative: 'assistant' | 'template';
  /** The calculated lines the explanation was based on, exactly as calculated. */
  facts: string[];
  calculatedAt: IsoDateTimeString;
}
