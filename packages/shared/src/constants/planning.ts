import type { BudgetPeriod, TransactionType } from './domain';

// Planning rules shared by the API (enforcement and calculation) and the web app (forms, labels):
// budgets, recurring schedules and their occurrences, subscriptions, and savings goals.

// --- Budgets -----------------------------------------------------------------------------------

/** `archived` budgets keep their definition and history but leave the default list. */
export const BUDGET_STATUSES = ['active', 'archived'] as const;

export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_STATUS_FILTERS = ['active', 'archived', 'all'] as const;

export type BudgetStatusFilter = (typeof BUDGET_STATUS_FILTERS)[number];

/** Budget periods that repeat; `custom` is one fixed date range. */
export const RECURRING_BUDGET_PERIODS = [
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const satisfies readonly BudgetPeriod[];

export type RecurringBudgetPeriod = (typeof RECURRING_BUDGET_PERIODS)[number];

export function isRecurringBudgetPeriod(period: BudgetPeriod): period is RecurringBudgetPeriod {
  return period !== 'custom';
}

/**
 * How a budget stands in one period. `limit_reached` is exactly the limit; `over_budget` is beyond
 * it; `approaching_limit` means an alert threshold below 100 % has been reached;
 * `not_applicable` is a period that has not started yet.
 */
export const BUDGET_PROGRESS_STATUSES = [
  'on_track',
  'approaching_limit',
  'limit_reached',
  'over_budget',
  'not_applicable',
] as const;

export type BudgetProgressStatus = (typeof BUDGET_PROGRESS_STATUSES)[number];

/** Where a budget's shown period lies relative to the reference date. */
export const BUDGET_TIMINGS = ['upcoming', 'current', 'ended'] as const;

export type BudgetTiming = (typeof BUDGET_TIMINGS)[number];

/**
 * Alert thresholds in basis points of the limit (8000 = 80 %). Reaching the limit itself is always
 * reported (`limit_reached`), so thresholds stay strictly below 100 %.
 */
export const DEFAULT_BUDGET_ALERT_THRESHOLDS_BP: readonly number[] = [8000];
export const MAX_BUDGET_ALERT_THRESHOLDS = 3;
export const MIN_BUDGET_ALERT_THRESHOLD_BP = 100;
export const MAX_BUDGET_ALERT_THRESHOLD_BP = 9900;

/** Upper bound of one budget list (personal budgets are few; the list is never paginated). */
export const MAX_BUDGETS = 200;

/** Budgets the summary lists as needing attention. */
export const BUDGET_SUMMARY_HIGHLIGHTS = 4;

// --- Recurring schedules -------------------------------------------------------------------------

/** Only income and expenses can recur in this phase; transfers stay one-off. */
export const RECURRING_TYPES = ['income', 'expense'] as const satisfies readonly TransactionType[];

export type RecurringType = (typeof RECURRING_TYPES)[number];

/** Combined with `interval`: every 2 weeks is `weekly` × 2, quarterly is `monthly` × 3. */
export const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** Largest interval per frequency (every 52 weeks, every 24 months, every 10 years). */
export const MAX_RECURRING_INTERVAL: Readonly<Record<RecurringFrequency, number>> = {
  weekly: 52,
  monthly: 24,
  yearly: 10,
};

export const RECURRING_SCHEDULE_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;

export type RecurringScheduleStatus = (typeof RECURRING_SCHEDULE_STATUSES)[number];

export const RECURRING_STATUS_FILTERS = ['current', 'archived', 'all'] as const;

export type RecurringStatusFilter = (typeof RECURRING_STATUS_FILTERS)[number];

/**
 * What the person did with an occurrence, as stored. Only occurrences someone acted on are stored;
 * every other date of the rule is pending. `paused` marks an occurrence that fell while the
 * schedule was paused and is therefore not owed.
 */
export const OCCURRENCE_STATES = ['postponed', 'recorded', 'skipped', 'paused'] as const;

export type OccurrenceState = (typeof OCCURRENCE_STATES)[number];

/**
 * How an occurrence looks today. `upcoming`, `due` (today), and `overdue` are pending — expected
 * money that has not moved. `recorded` has a real transaction. A pending occurrence may also be
 * postponed (its due date differs from its scheduled date).
 */
export const OCCURRENCE_STATUSES = [
  'upcoming',
  'due',
  'overdue',
  'recorded',
  'skipped',
  'paused',
] as const;

export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

/** Days of advance notice shown in the app before a payment is due. */
export const MAX_REMINDER_DAYS = 60;

/** Widest date range of one upcoming-occurrences request. */
export const MAX_UPCOMING_RANGE_DAYS = 366;

/** Default range of the upcoming list: today and the next 30 days. */
export const DEFAULT_UPCOMING_DAYS = 30;

/** Upper bound of occurrences returned by one request (overdue ones included). */
export const MAX_UPCOMING_OCCURRENCES = 500;

/** Upper bound of schedules per list. */
export const MAX_RECURRING_SCHEDULES = 200;

/** How far ahead an occurrence can be recorded, skipped, or postponed. */
export const OCCURRENCE_ACTION_HORIZON_DAYS = 366;

/** Largest postponement, counted from the scheduled date. */
export const MAX_POSTPONE_DAYS = 366;

/**
 * An existing transaction may settle an occurrence when it happened at most this many days before
 * the scheduled date or after the due date (bills are often paid early or late, never by a year).
 */
export const OCCURRENCE_LINK_WINDOW_DAYS = 45;

/** Candidate transactions offered when linking a payment to an occurrence. */
export const MAX_OCCURRENCE_LINK_CANDIDATES = 10;

// --- Subscriptions -------------------------------------------------------------------------------

/**
 * A subscription is a recurring expense the person marked as one. `cancelled` subscriptions keep
 * their history but expect nothing after their end date.
 */
export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'cancelled', 'archived'] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Forecast windows of the subscription summary, in days from today (inclusive of today). */
export const SUBSCRIPTION_FORECAST_DAYS = 30;
export const SUBSCRIPTION_FORECAST_MONTHS = 12;

// --- Savings goals -------------------------------------------------------------------------------

export const SAVINGS_GOAL_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;

export type SavingsGoalStatus = (typeof SAVINGS_GOAL_STATUSES)[number];

export const SAVINGS_GOAL_STATUS_FILTERS = ['current', 'archived', 'all'] as const;

export type SavingsGoalStatusFilter = (typeof SAVINGS_GOAL_STATUS_FILTERS)[number];

/**
 * How a contribution changes the tracked amount: put money aside, take some back, or state the new
 * total (the API works out the difference under a lock).
 */
export const GOAL_CONTRIBUTION_KINDS = ['add', 'withdraw', 'set'] as const;

export type GoalContributionKind = (typeof GOAL_CONTRIBUTION_KINDS)[number];

export const MAX_SAVINGS_GOALS = 100;

/** Contributions shown with a goal's details (newest first). */
export const GOAL_CONTRIBUTION_HISTORY_LIMIT = 50;
