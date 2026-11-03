// Financial intelligence (Phase 11): forecasts, spending predictions, budget suggestions, goal
// projections, scenarios, health indicators, and recommendations. Every figure is calculated by
// deterministic services from recorded transactions and confirmed schedules; these are estimates,
// never guarantees, and the AI may only explain them.

/** Version of the documented methods; returned with every result so stale reasoning is visible. */
export const INTELLIGENCE_METHODOLOGY_VERSION = '2026-11.1';

// --- History and data sufficiency ----------------------------------------------------------------

/**
 * How much history an estimate stands on. `insufficient`: no estimate is made. `limited`: an
 * estimate is shown with a strong warning. `moderate` and `strong`: more completed months.
 */
export const DATA_SUFFICIENCY_LEVELS = ['insufficient', 'limited', 'moderate', 'strong'] as const;

export type DataSufficiencyLevel = (typeof DATA_SUFFICIENCY_LEVELS)[number];

/** The documented thresholds behind every estimate (see docs/database-design.md §3h). */
export const INTELLIGENCE_RULES = {
  /** Completed calendar months looked back on for baselines. */
  historyMonths: 6,
  /** Fewer completed months with activity than this: no estimate (`insufficient`). */
  minMonthsForEstimate: 2,
  /** At least this many months with activity: `moderate`. */
  moderateMonths: 3,
  /** Activity in every one of `historyMonths` months: `strong`. */
  strongMonths: 6,
  /** Fewer expenses than this across the history: `insufficient`. */
  minExpensesForEstimate: 10,
  /** A category needs spending in this many completed months for its own estimate. */
  minCategoryMonths: 2,
  /** Changes of at least this much (basis points) count as rising or falling. */
  trendChangeBp: 2_000n,
  /** Income whose monthly range exceeds this share of its median is called irregular. */
  irregularIncomeSpreadBp: 5_000n,
  /** Scheduled amounts above this share of all expected expenses mark a schedule-heavy forecast. */
  scheduleHeavyShareBp: 7_000n,
} as const;

// --- Cash-flow forecast --------------------------------------------------------------------------

export const FORECAST_HORIZONS = [7, 30, 60, 90] as const;

export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];

export const DEFAULT_FORECAST_HORIZON: ForecastHorizon = 30;

/**
 * `scheduled`: only income from confirmed recurring schedules counts. `scheduled_and_estimated`:
 * the typical monthly income that had no schedule is added as an estimate (never assumed by
 * default, because past income is not a promise of future income).
 */
export const FORECAST_INCOME_BASES = ['scheduled', 'scheduled_and_estimated'] as const;

export type ForecastIncomeBasis = (typeof FORECAST_INCOME_BASES)[number];

export const FORECAST_WARNING_CODES = [
  'insufficient_history',
  'limited_history',
  'irregular_income',
  'schedule_heavy',
  'postponed_timing',
  'overdue_items',
  'multiple_currencies',
  'account_allocation',
  'no_schedules',
  'truncated',
  'estimated_income_included',
] as const;

export type ForecastWarningCode = (typeof FORECAST_WARNING_CODES)[number];

/** Upper bound of scheduled items listed with one currency's forecast. */
export const FORECAST_ITEM_LIMIT = 60;

// --- Spending predictions ------------------------------------------------------------------------

export const SPENDING_FORECAST_PERIODS = ['this-month', 'next-month'] as const;

export type SpendingForecastPeriod = (typeof SPENDING_FORECAST_PERIODS)[number];

export const SPENDING_TRENDS = ['rising', 'falling', 'stable', 'unknown'] as const;

export type SpendingTrend = (typeof SPENDING_TRENDS)[number];

// --- Historical spending patterns ----------------------------------------------------------------

export const SPENDING_PATTERN_PERIODS = [
  'last-30-days',
  'last-90-days',
  'last-6-months',
  'last-12-months',
  'this-year',
  'last-year',
  'custom',
] as const;

export type SpendingPatternPeriod = (typeof SPENDING_PATTERN_PERIODS)[number];

export type SpendingPatternPreset = Exclude<SpendingPatternPeriod, 'custom'>;

export const DEFAULT_SPENDING_PATTERN_PERIOD: SpendingPatternPreset = 'last-90-days';

/** Widest custom range for historical analysis (about three years). */
export const MAX_PATTERN_RANGE_DAYS = 1_096;

/** Merchants and categories listed by name in one analysis. */
export const PATTERN_LIST_LIMIT = 10;

// --- Budget recommendations ----------------------------------------------------------------------

/**
 * `historical_average`: the mean of completed months. `conservative`: the lower quartile — an
 * amount already managed in at least a quarter of those months.
 */
export const BUDGET_SUGGESTION_BASES = ['historical_average', 'conservative'] as const;

export type BudgetSuggestionBasis = (typeof BUDGET_SUGGESTION_BASES)[number];

export const BUDGET_HEALTH_FLAGS = [
  'repeated_overspending',
  'consistently_unused',
  'limit_below_typical',
  'rising_spending',
  'high_variability',
] as const;

export type BudgetHealthFlag = (typeof BUDGET_HEALTH_FLAGS)[number];

/** Completed budget periods checked for over- and under-spending. */
export const BUDGET_REVIEW_PERIODS = 4;

// --- Savings-goal projections --------------------------------------------------------------------

export const GOAL_PROJECTION_STATES = [
  'reached',
  'on_track',
  'behind',
  'no_target_date',
  'target_date_passed',
  'insufficient_history',
  'paused',
] as const;

export type GoalProjectionState = (typeof GOAL_PROJECTION_STATES)[number];

export const GOAL_PACE_UNAVAILABLE_REASONS = [
  'no_contributions',
  'too_little_history',
  'not_increasing',
] as const;

export type GoalPaceUnavailableReason = (typeof GOAL_PACE_UNAVAILABLE_REASONS)[number];

// --- Financial health ----------------------------------------------------------------------------

export const HEALTH_GROUPS = ['cash_flow', 'budgets', 'recurring', 'goals', 'liquidity'] as const;

export type HealthGroup = (typeof HEALTH_GROUPS)[number];

// --- Recommendations -----------------------------------------------------------------------------

export const RECOMMENDATION_TYPES = [
  'forecast_shortfall',
  'budget_overspending',
  'budget_suggestion',
  'goal_behind',
  'subscription_review',
  'payments_clustered',
  'category_increase',
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_PRIORITIES = ['high', 'medium', 'low'] as const;

export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

/** What a recommendation was worked out from. */
export const RECOMMENDATION_SOURCES = [
  'cash_flow_forecast',
  'budgets',
  'spending_history',
  'savings_goals',
  'subscriptions',
  'recurring_schedules',
] as const;

export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];

export const RECOMMENDATION_STATES = ['new', 'reviewed'] as const;

export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

// --- Scenarios -----------------------------------------------------------------------------------

export const SCENARIO_ADJUSTMENT_KINDS = [
  'category_spending',
  'income_change',
  'cancel_schedule',
  'change_schedule_amount',
  'monthly_expense',
  'monthly_income',
  'one_time_expense',
  'debt_payment',
  'goal_contribution',
  'goal_target_date',
] as const;

export type ScenarioAdjustmentKind = (typeof SCENARIO_ADJUSTMENT_KINDS)[number];

export const SCENARIO_HORIZONS = [30, 60, 90, 180, 365] as const;

export type ScenarioHorizon = (typeof SCENARIO_HORIZONS)[number];

export const SCENARIO_LIMITS = {
  adjustments: 10,
  /** Saved scenarios per person. */
  scenarios: 50,
  /** Scenarios compared side by side. */
  compare: 3,
  name: 80,
  label: 60,
  /** A reduction can remove at most all of an amount (100 %). */
  maxDecreaseBp: 10_000,
  /** An increase can at most multiply an amount elevenfold (+1000 %). */
  maxIncreaseBp: 100_000,
  /** Months an ongoing change can be limited to. */
  maxMonths: 12,
  pageSize: 20,
} as const;

// --- AI explanations -----------------------------------------------------------------------------

export const INTELLIGENCE_EXPLANATION_SUBJECTS = [
  'cashflow_forecast',
  'spending_forecast',
  'financial_health',
  'budget_recommendations',
  'goal_projections',
  'recommendation',
  'scenario',
] as const;

export type IntelligenceExplanationSubject = (typeof INTELLIGENCE_EXPLANATION_SUBJECTS)[number];
