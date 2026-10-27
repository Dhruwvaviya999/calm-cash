// Dashboard rules shared by the API (calculation) and the web app (controls and labels).

/** Periods the dashboard offers. Presets resolve against "today" in the user's time zone. */
export const DASHBOARD_PERIODS = [
  'this-month',
  'last-month',
  'last-3-months',
  'last-6-months',
  'this-year',
  'custom',
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export type DashboardPreset = Exclude<DashboardPeriod, 'custom'>;

export const DEFAULT_DASHBOARD_PERIOD: DashboardPreset = 'this-month';

/** Calendar buckets of the cash-flow trend (weeks start on Monday). */
export const TREND_GRANULARITIES = ['day', 'week', 'month', 'year'] as const;

export type TrendGranularity = (typeof TREND_GRANULARITIES)[number];

/** Categories shown by name; the rest are added up into one "Other" entry. */
export const DASHBOARD_CATEGORY_LIMIT = 6;

/** Transactions in the dashboard's recent-activity list. */
export const DASHBOARD_RECENT_LIMIT = 6;

/** Why a ratio could not be calculated (instead of dividing by zero). */
export const RATIO_UNAVAILABLE_REASONS = [
  'no_income',
  'no_previous_value',
  // Planning (Phase 7): a budget without a limit, a goal without a target.
  'no_limit',
  'no_target',
] as const;

export type RatioUnavailableReason = (typeof RATIO_UNAVAILABLE_REASONS)[number];
