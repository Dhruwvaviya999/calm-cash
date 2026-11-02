import {
  formatDecimalAmount,
  parseMinorUnits,
  type AiReportKind,
  type RecurringCandidateDto,
  type RecurringCandidateFrequency,
  type SpendingInsightKind,
} from '@calmcash/shared';
import {
  CalendarClock,
  Repeat,
  Store,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { ScheduleFormValues } from '@/features/recurring';

// Words for insights and repeating-payment suggestions, and the planning form values a
// suggestion starts from. No React here.

export const INSIGHT_KIND_PRESENTATION: Readonly<
  Record<SpendingInsightKind, { label: string; icon: LucideIcon }>
> = {
  category_increase: { label: 'Spending up', icon: TrendingUp },
  category_decrease: { label: 'Spending down', icon: TrendingDown },
  unusual_expense: { label: 'Larger than usual', icon: TriangleAlert },
  frequent_merchant: { label: 'Frequent payments', icon: Store },
  income_change: { label: 'Income change', icon: Wallet },
};

export const FREQUENCY_LABELS: Readonly<Record<RecurringCandidateFrequency, string>> = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

export const CANDIDATE_ICON: LucideIcon = Repeat;
export const UPCOMING_ICON: LucideIcon = CalendarClock;

export const REPORT_KINDS: readonly { value: AiReportKind; label: string; description: string }[] =
  [
    {
      value: 'period',
      label: 'Financial summary',
      description: 'Money in and out, savings rate, top categories, and spending patterns.',
    },
    {
      value: 'categories',
      label: 'Spending by category',
      description: 'Where the money went, by category, with patterns.',
    },
    {
      value: 'merchants',
      label: 'Where you paid most often',
      description: 'The merchants and payees you paid most.',
    },
    {
      value: 'subscriptions',
      label: 'Subscriptions and bills',
      description: 'Your subscriptions and the payments coming up.',
    },
    {
      value: 'budgets',
      label: 'Budget performance',
      description: 'How each budget is doing this period.',
    },
  ];

/** Repeat preset and timing fields of the planning form for a noticed rhythm. */
function timingFor(
  frequency: RecurringCandidateFrequency,
): Pick<ScheduleFormValues, 'repeat' | 'frequency' | 'interval'> {
  switch (frequency) {
    case 'weekly':
      return { repeat: 'weekly:1', frequency: 'weekly', interval: '1' };
    case 'monthly':
      return { repeat: 'monthly:1', frequency: 'monthly', interval: '1' };
    case 'quarterly':
      return { repeat: 'monthly:3', frequency: 'monthly', interval: '3' };
    case 'yearly':
      return { repeat: 'yearly:1', frequency: 'yearly', interval: '1' };
  }
}

/**
 * The planning form, started from a repeating payment CalmCash noticed: its usual amount, account,
 * category, rhythm, and the estimated next date. The person checks and saves it themselves.
 */
export function scheduleValuesFromCandidate(
  candidate: RecurringCandidateDto,
): Partial<ScheduleFormValues> {
  return {
    name: candidate.label.slice(0, 120),
    type: 'expense',
    amount: formatDecimalAmount(parseMinorUnits(candidate.typicalAmountMinor), candidate.currency),
    currency: candidate.currency,
    ...(candidate.accountId === undefined ? {} : { accountId: candidate.accountId }),
    ...(candidate.categoryId === undefined ? {} : { categoryId: candidate.categoryId }),
    ...(candidate.merchant === undefined ? {} : { merchant: candidate.merchant }),
    ...timingFor(candidate.frequency),
    startDate: candidate.nextEstimatedDate,
  };
}
