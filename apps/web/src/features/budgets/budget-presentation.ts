import type {
  BudgetPeriod,
  BudgetProgressDto,
  BudgetProgressStatus,
  BudgetWithProgressDto,
  RatioDto,
  RecurringBudgetPeriod,
} from '@calmcash/shared';
import type { Route } from 'next';

import type { StatusTone } from '@/components/feedback/status-badge';
import type { ProgressTone } from '@/components/finance/progress-meter';
import { formatBasisPoints, formatDate } from '@/lib/format';

// How budgets are presented. Every figure comes from the API; this module only chooses words,
// tones, and links, and rounds percentages for display.

export interface BudgetStatusPresentation {
  label: string;
  badgeTone: StatusTone;
  meterTone: ProgressTone;
}

/** Status in words and tones; tones always come with the label, never alone. */
export const BUDGET_STATUS_PRESENTATION: Readonly<
  Record<BudgetProgressStatus, BudgetStatusPresentation>
> = {
  on_track: { label: 'On track', badgeTone: 'positive', meterTone: 'positive' },
  approaching_limit: { label: 'Close to limit', badgeTone: 'warning', meterTone: 'warning' },
  limit_reached: { label: 'Limit reached', badgeTone: 'warning', meterTone: 'warning' },
  over_budget: { label: 'Over budget', badgeTone: 'negative', meterTone: 'negative' },
  not_applicable: { label: 'Not started', badgeTone: 'neutral', meterTone: 'neutral' },
};

export const BUDGET_PERIOD_LABELS: Readonly<Record<BudgetPeriod, string>> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Custom dates',
};

/** Options of the "Every …" select in the form. */
export const PERIOD_OPTION_LABELS: Readonly<Record<BudgetPeriod, string>> = {
  weekly: 'Week',
  monthly: 'Month',
  quarterly: 'Quarter',
  yearly: 'Year',
  custom: 'Custom dates',
};

/** "this week", "this month", … for the summary totals. */
export const CURRENT_PERIOD_LABELS: Readonly<Record<RecurringBudgetPeriod, string>> = {
  weekly: 'This week',
  monthly: 'This month',
  quarterly: 'This quarter',
  yearly: 'This year',
};

/** Percentage for drawing a bar (never shown as a number). */
export function meterPercent(ratio: RatioDto): number {
  return ratio.status === 'available' ? Number(BigInt(ratio.basisPoints)) / 100 : 0;
}

/** "84.5%", or "—" when no ratio exists. Over 100 % is shown as it is. */
export function describeRatio(ratio: RatioDto): string {
  return ratio.status === 'available' ? formatBasisPoints(ratio.basisPoints) : '—';
}

/** "1 Oct – 31 Oct 2026". */
export function describeRange(range: { from: string; to: string }): string {
  return range.from === range.to
    ? formatDate(range.from, 'dayMonthYear')
    : `${formatDate(range.from, 'dayMonth')} – ${formatDate(range.to, 'dayMonthYear')}`;
}

export function describeBudgetWindow(progress: BudgetProgressDto): string {
  return `${describeRange(progress)}${progress.partial ? ' (part of the period)' : ''}`;
}

/** Alert thresholds as percentages, e.g. `[8000]` → "80%". */
export function describeThresholds(thresholds: readonly number[]): string {
  return thresholds.length === 0
    ? 'No early alerts'
    : thresholds.map((value) => `${String(value / 100)}%`).join(', ');
}

/**
 * The transactions behind a budget's figure: active expenses in its currency and period, in its
 * category (and subcategories — the transaction filter includes them) or in every category.
 */
export function budgetTransactionsHref(item: BudgetWithProgressDto): {
  pathname: Route;
  query: Record<string, string>;
} {
  return {
    pathname: '/transactions',
    query: {
      type: 'expense',
      currency: item.budget.currency,
      from: item.progress.from,
      to: item.progress.to,
      ...(item.budget.categoryId === undefined ? {} : { categoryId: item.budget.categoryId }),
    },
  };
}

/** The same scope as a transactions API query string (for previews inside the budget). */
export function budgetTransactionsQuery(item: BudgetWithProgressDto, pageSize: number): string {
  const params = new URLSearchParams({
    ...budgetTransactionsHref(item).query,
    sort: 'newest',
    page: '1',
    pageSize: String(pageSize),
  });
  return params.toString();
}

/** What a budget covers, in words. */
export function describeScope(item: BudgetWithProgressDto): string {
  if (item.category === undefined) {
    return 'All spending';
  }
  return item.category.parentName === undefined
    ? `${item.category.name} and its subcategories`
    : `${item.category.parentName} › ${item.category.name}`;
}
