'use client';

import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  type BudgetSummaryDto,
  type CurrencyCode,
  type SavingsGoalListDto,
  type UpcomingOccurrencesDto,
} from '@calmcash/shared';
import { useCallback, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { BudgetProgress, BudgetStatusCounts, BudgetTotals } from '@/features/budgets';
import { GoalProgress } from '@/features/goals';
import { isPendingOccurrence, OccurrenceList } from '@/features/recurring';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { describeRequestError } from '@/lib/form-errors';
import { getBudgetSummary } from '@/services/budgets.service';
import { listGoals } from '@/services/goals.service';
import { getUpcomingOccurrences } from '@/services/recurring.service';

import { SectionCard, SectionLinkArrow } from './dashboard-sections';

// Planning previews on the dashboard. Each loads on its own (one failing never hides another),
// shows only live data, and links to its planning section. Budget spending and goal progress are
// separate from the cash-flow figures above: they answer different questions.

const UPCOMING_DAYS = 14;
const PREVIEW_ITEMS = 4;

function PreviewError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
}): ReactNode {
  return (
    <ErrorState
      headingLevel="h2"
      title={`${what} could not be loaded`}
      description={`${describeRequestError(error)} The rest of the dashboard still works.`}
      onRetry={onRetry}
      className="border-0 bg-transparent px-0 py-6 shadow-none"
    />
  );
}

function Loading({ label }: { label: string }): ReactNode {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <ListSkeleton rows={3} />
    </div>
  );
}

export function BudgetsPreview({ currency }: { currency: CurrencyCode | undefined }): ReactNode {
  const query = currency === undefined ? '' : `currency=${currency}`;
  const { state, reload } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<BudgetSummaryDto> => getBudgetSummary(query, signal),
      [query],
    ),
  );
  const monthly =
    state.status === 'success'
      ? (state.data.totals.find((entry) => entry.period === 'monthly') ?? state.data.totals[0])
      : undefined;
  return (
    <SectionCard
      id="budgets-preview-heading"
      title="Budgets"
      description={
        state.status === 'success' && state.data.currency !== undefined
          ? `Current periods, ${state.data.currency}`
          : undefined
      }
      action={<SectionLinkArrow href="/budgets">All budgets</SectionLinkArrow>}
    >
      {state.status === 'loading' ? (
        <Loading label="Loading your budgets…" />
      ) : state.status === 'error' ? (
        <PreviewError what="Budgets" error={state.error} onRetry={reload} />
      ) : state.data.currency === undefined ? (
        <p className="py-2 text-sm text-muted-foreground">
          No budgets yet. Set a monthly limit for a category to see how much is left here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {monthly !== undefined && (
            <BudgetTotals totals={monthly} currency={state.data.currency} />
          )}
          <BudgetStatusCounts summary={state.data} />
          <ul className="flex flex-col gap-4">
            {state.data.highlights.slice(0, 3).map((item) => (
              <li key={item.budget.id}>
                <BudgetProgress item={item} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

export function UpcomingPreview({ timeZone }: { timeZone: string }): ReactNode {
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const query = new URLSearchParams({
    from: today,
    to: addDaysToIsoDate(today, UPCOMING_DAYS),
  }).toString();
  const { state, reload } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<UpcomingOccurrencesDto> =>
        getUpcomingOccurrences(query, signal),
      [query],
    ),
  );
  const pending =
    state.status === 'success'
      ? state.data.items.filter((item) => isPendingOccurrence(item.occurrence))
      : [];
  return (
    <SectionCard
      id="upcoming-preview-heading"
      title="Coming up"
      description={
        state.status === 'success'
          ? `Overdue and the next ${String(UPCOMING_DAYS)} days · expected, not yet recorded`
          : undefined
      }
      action={
        <SectionLinkArrow href={{ pathname: '/budgets', query: { section: 'recurring' } }}>
          Bills
        </SectionLinkArrow>
      }
    >
      {state.status === 'loading' ? (
        <Loading label="Loading upcoming payments…" />
      ) : state.status === 'error' ? (
        <PreviewError what="Upcoming payments" error={state.error} onRetry={reload} />
      ) : pending.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nothing due in the next {UPCOMING_DAYS} days.
        </p>
      ) : (
        <>
          {state.data.overdueCount > 0 && (
            <p className="text-sm font-medium text-expense">
              {state.data.overdueCount} overdue{' '}
              {state.data.overdueCount === 1 ? 'payment' : 'payments'}
            </p>
          )}
          <OccurrenceList
            label="Upcoming payments"
            items={pending.slice(0, PREVIEW_ITEMS)}
            today={state.data.today}
            compact
          />
          {pending.length > PREVIEW_ITEMS && (
            <p className="text-xs text-muted-foreground">
              and {pending.length - PREVIEW_ITEMS} more
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

export function GoalsPreview(): ReactNode {
  const { state, reload } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<SavingsGoalListDto> => listGoals('current', signal),
      [],
    ),
  );
  const goals =
    state.status === 'success'
      ? state.data.goals.filter((item) => item.goal.status !== 'completed')
      : [];
  return (
    <SectionCard
      id="goals-preview-heading"
      title="Savings goals"
      description="Money you set aside towards each goal (not your savings rate)."
      action={
        <SectionLinkArrow href={{ pathname: '/budgets', query: { section: 'goals' } }}>
          Goals
        </SectionLinkArrow>
      }
    >
      {state.status === 'loading' ? (
        <Loading label="Loading your goals…" />
      ) : state.status === 'error' ? (
        <PreviewError what="Savings goals" error={state.error} onRetry={reload} />
      ) : goals.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No goals in progress. Create one to track what you set aside.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {goals.slice(0, 3).map((item) => (
            <li key={item.goal.id} className="flex flex-col gap-1.5">
              <p className="truncate text-sm font-medium">{item.goal.name}</p>
              <GoalProgress item={item} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
