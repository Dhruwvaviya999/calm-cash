'use client';

import type { RecurringCandidateDto } from '@calmcash/shared';
import { CalendarPlus, MonitorPlay, Repeat, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useSignedInSession } from '@/features/auth';
import { ScheduleForm, usePlanningReferences } from '@/features/recurring';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { dismissRecurringCandidate, listRecurringCandidates } from '@/services/insights.service';

import { FREQUENCY_LABELS, scheduleValuesFromCandidate } from '../insights-presentation';

type Setup = { candidate: RecurringCandidateDto; variant: 'schedule' | 'subscription' } | undefined;

function CandidateRow({
  candidate,
  onSetUp,
  onDismiss,
}: {
  candidate: RecurringCandidateDto;
  onSetUp: (variant: 'schedule' | 'subscription') => void;
  onDismiss: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const varies = candidate.minAmountMinor !== candidate.maxAmountMinor;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{candidate.label}</span>
          <StatusBadge
            tone={candidate.strength === 'strong' ? 'positive' : 'neutral'}
            showIcon={false}
          >
            {candidate.strength === 'strong' ? 'Regular pattern' : 'Possible pattern'}
          </StatusBadge>
          {candidate.likelySubscription && (
            <StatusBadge tone="info" showIcon={false}>
              Looks like a subscription
            </StatusBadge>
          )}
        </div>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <FinancialAmount
            amountMinor={candidate.typicalAmountMinor}
            currency={candidate.currency}
            size="sm"
          />
          <span className="text-muted-foreground">
            {varies ? 'usually · ' : ''}
            {FREQUENCY_LABELS[candidate.frequency].toLowerCase()} · last on{' '}
            {formatDate(candidate.lastDate, 'dayMonthYear')} · next expected around{' '}
            {formatDate(candidate.nextEstimatedDate, 'dayMonthYear')}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{candidate.evidence}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={candidate.likelySubscription ? 'outline' : 'default'}
          className="h-11 sm:h-8"
          onClick={() => {
            onSetUp('schedule');
          }}
        >
          <CalendarPlus aria-hidden="true" />
          Set up as a bill
        </Button>
        <Button
          type="button"
          size="sm"
          variant={candidate.likelySubscription ? 'default' : 'outline'}
          className="h-11 sm:h-8"
          onClick={() => {
            onSetUp('subscription');
          }}
        >
          <MonitorPlay aria-hidden="true" />
          Track as subscription
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={busy}
          aria-label={`Not recurring: ${candidate.label}`}
          onClick={() =>
            void (async () => {
              setBusy(true);
              await onDismiss();
              setBusy(false);
            })()
          }
        >
          <X aria-hidden="true" />
          Not recurring
        </Button>
      </div>
    </li>
  );
}

/**
 * Payments that repeat at a steady rhythm but have no bill or subscription yet. CalmCash never
 * creates one by itself: the ordinary planning form opens with the noticed values to check.
 */
export function RecurringCandidates(): ReactNode {
  const { user } = useSignedInSession();
  const candidates = useAsyncResource(listRecurringCandidates);
  const { references } = usePlanningReferences();
  const [setup, setSetup] = useState<Setup>();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string }>();

  return (
    <section aria-labelledby="recurring-candidates-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="recurring-candidates-heading"
        title="Possible bills and subscriptions"
        description="Payments that seem to repeat. Nothing is set up until you choose to."
      />
      {candidates.state.status === 'loading' && <ListSkeleton rows={2} />}
      {candidates.state.status === 'error' && (
        <ErrorState
          title="Repeating payments could not be checked"
          description={describeRequestError(candidates.state.error)}
          onRetry={candidates.reload}
        />
      )}
      {candidates.state.status === 'success' &&
        (candidates.state.data.items.length === 0 ? (
          <EmptyState
            icon={Repeat}
            headingLevel="h3"
            title="No new repeating payments"
            description="When the same payment shows up at a steady rhythm at least three times, it appears here."
          />
        ) : (
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {candidates.state.data.items.map((candidate) => (
              <CandidateRow
                key={candidate.key}
                candidate={candidate}
                onSetUp={(variant) => {
                  setNotice(undefined);
                  setSetup({ candidate, variant });
                }}
                onDismiss={async () => {
                  setNotice(undefined);
                  try {
                    await dismissRecurringCandidate(candidate.key);
                    candidates.refresh();
                  } catch (error: unknown) {
                    setNotice({ tone: 'error', message: describeRequestError(error) });
                  }
                }}
              />
            ))}
          </ul>
        ))}
      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}

      <Sheet
        open={setup !== undefined}
        onOpenChange={(open) => {
          if (!open) setSetup(undefined);
        }}
      >
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
            <SheetTitle className="text-lg">
              {setup?.variant === 'subscription' ? 'Track a subscription' : 'Set up a bill'}
            </SheetTitle>
            <SheetDescription>
              Filled in from the payments CalmCash noticed. Check the details; saving plans future
              payments but records nothing.
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            {setup !== undefined && (
              <ScheduleForm
                key={`${setup.candidate.key}-${setup.variant}`}
                mode={{
                  kind: 'create',
                  variant: setup.variant,
                  initial: scheduleValuesFromCandidate(setup.candidate),
                }}
                accounts={references.accounts}
                categories={references.categories}
                defaultCurrency={user.preferredCurrency}
                timeZone={user.timezone}
                onCancel={() => {
                  setSetup(undefined);
                }}
                onSaved={(item) => {
                  setSetup(undefined);
                  setNotice({
                    tone: 'success',
                    message: `${item.schedule.name} is set up. You will find it under Budgets.`,
                  });
                  candidates.refresh();
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
