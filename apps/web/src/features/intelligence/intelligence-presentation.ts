import {
  formatDecimalAmount,
  parseMinorUnits,
  type BudgetPrefillDto,
  type DataSufficiencyLevel,
  type ForecastBucketDto,
  type ForecastHorizon,
  type GoalProjectionState,
  type HealthGroup,
  type RecommendationPriority,
  type ScenarioAdjustmentKind,
} from '@calmcash/shared';

import type { StatusTone } from '@/components/feedback/status-badge';
import type { BudgetFormValues } from '@/features/budgets';
import { formatDate } from '@/lib/format';

// Words, tones, and chart points for the financial-intelligence views. No React here. Every label
// says whether a figure is actual, scheduled, or estimated; estimates are never shown as facts.

export const SUFFICIENCY_PRESENTATION: Readonly<
  Record<DataSufficiencyLevel, { label: string; tone: StatusTone; description: string }>
> = {
  insufficient: {
    label: 'Not enough history',
    tone: 'neutral',
    description: 'Too little recorded history to estimate; only scheduled payments are used.',
  },
  limited: {
    label: 'Limited history',
    tone: 'warning',
    description: 'Based on only two completed months — treat it as a rough guide.',
  },
  moderate: {
    label: 'Some history',
    tone: 'info',
    description: 'Based on three to five completed months.',
  },
  strong: {
    label: 'Six months of history',
    tone: 'positive',
    description: 'Based on six completed months with recorded spending.',
  },
};

export const FORECAST_HORIZON_OPTIONS: readonly { value: ForecastHorizon; label: string }[] = [
  { value: 7, label: 'Next 7 days' },
  { value: 30, label: 'Next 30 days' },
  { value: 60, label: 'Next 60 days' },
  { value: 90, label: 'Next 90 days' },
];

export const PRIORITY_PRESENTATION: Readonly<
  Record<RecommendationPriority, { label: string; tone: StatusTone }>
> = {
  high: { label: 'Worth a look soon', tone: 'warning' },
  medium: { label: 'Worth a look', tone: 'info' },
  low: { label: 'For your information', tone: 'neutral' },
};

export const GOAL_STATE_PRESENTATION: Readonly<
  Record<GoalProjectionState, { label: string; tone: StatusTone }>
> = {
  reached: { label: 'Target reached', tone: 'positive' },
  on_track: { label: 'On track at recent pace', tone: 'positive' },
  behind: { label: 'Behind at recent pace', tone: 'warning' },
  no_target_date: { label: 'No target date', tone: 'neutral' },
  target_date_passed: { label: 'Target date passed', tone: 'warning' },
  insufficient_history: { label: 'Not enough history for a date', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'neutral' },
};

export const HEALTH_GROUP_LABELS: Readonly<Record<HealthGroup, string>> = {
  cash_flow: 'Cash flow',
  budgets: 'Budgets',
  recurring: 'Bills and subscriptions',
  goals: 'Savings goals',
  liquidity: 'Money held and owed',
};

export const ADJUSTMENT_KIND_LABELS: Readonly<Record<ScenarioAdjustmentKind, string>> = {
  category_spending: 'Spend more or less in a category',
  income_change: 'Income goes up or down',
  cancel_schedule: 'Stop a bill, subscription, or income',
  change_schedule_amount: 'Change a scheduled amount',
  monthly_expense: 'A new monthly cost',
  monthly_income: 'Extra monthly income',
  one_time_expense: 'A one-off expense',
  debt_payment: 'Pay off part of a card or loan',
  goal_contribution: 'Save a monthly amount for a goal',
  goal_target_date: 'Move a goal’s target date',
};

/**
 * A minor-units string as a plain number, for bar and line *lengths* only. Every value a person
 * reads comes from the exact strings.
 */
export function chartNumber(amountMinor: string): number {
  return Number(amountMinor);
}

export interface ForecastPoint {
  label: string;
  /** Projected net position at the end of the bucket. */
  position: number;
  scheduledIncome: number;
  scheduledExpense: number;
  estimated: number;
}

/** Chart points of a forecast; the first point is today. */
export function forecastPoints(buckets: readonly ForecastBucketDto[]): ForecastPoint[] {
  return buckets.map((bucket) => ({
    label:
      bucket.start === bucket.end
        ? formatDate(bucket.start, 'dayMonth')
        : `${formatDate(bucket.start, 'dayMonth')}–${formatDate(bucket.end, 'dayMonth')}`,
    position: chartNumber(bucket.projectedPositionMinor),
    scheduledIncome: chartNumber(bucket.scheduledIncomeMinor),
    scheduledExpense: chartNumber(bucket.scheduledExpenseMinor),
    estimated: chartNumber(bucket.estimatedVariableMinor),
  }));
}

/** The ordinary budget form, started from a suggestion. The person checks and saves it. */
export function budgetValuesFromPrefill(prefill: BudgetPrefillDto): Partial<BudgetFormValues> {
  return {
    name: prefill.name,
    scope: prefill.categoryId === undefined ? 'overall' : 'category',
    categoryId: prefill.categoryId ?? '',
    limit: formatDecimalAmount(parseMinorUnits(prefill.limitMinor), prefill.currency),
    currency: prefill.currency,
    period: prefill.period,
  };
}

/** `"2026-10"` → `"Oct 26"`. */
export function monthLabel(month: string): string {
  return formatDate(`${month}-01`, 'monthShortYear');
}

/** Basis points as a whole percentage for form fields, e.g. 1500 → `"15"`. */
export function percentFromBasisPoints(basisPoints: number): string {
  return Number.isInteger(basisPoints / 100)
    ? String(basisPoints / 100)
    : (basisPoints / 100).toFixed(2);
}

/** A typed percentage ("15", "12.5") as basis points, or undefined when it is not one. */
export function basisPointsFromPercent(text: string): number | undefined {
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return undefined;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const value = whole * 100 + fraction;
  return value > 0 ? value : undefined;
}
