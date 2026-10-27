'use client';

import type {
  OccurrenceDto,
  RecurringScheduleDetailDto,
  RecurringScheduleItemDto,
  UpcomingOccurrenceDto,
} from '@calmcash/shared';
import { Archive, ArchiveRestore, CirclePause, CirclePlay, Pencil, Square } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { getSchedule } from '@/services/recurring.service';

import { describeFrequency, SCHEDULE_STATUS_PRESENTATION } from '../recurring-presentation';
import { OccurrenceList, type OccurrenceActions } from './occurrence-list';

export type ScheduleLifecycle = 'pause' | 'resume' | 'end' | 'archive' | 'restore';

function asUpcoming(
  detail: RecurringScheduleDetailDto,
  occurrence: OccurrenceDto,
): UpcomingOccurrenceDto {
  return {
    occurrence,
    schedule: detail.schedule,
    ...(detail.account === undefined ? {} : { account: detail.account }),
    ...(detail.category === undefined ? {} : { category: detail.category }),
  };
}

function Details({
  scheduleId,
  actions,
  onEdit,
  onLifecycle,
}: {
  scheduleId: string;
  actions: OccurrenceActions;
  onEdit: (item: RecurringScheduleItemDto) => void;
  onLifecycle: (item: RecurringScheduleItemDto, action: ScheduleLifecycle) => void;
}): ReactNode {
  const { state, reload } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<RecurringScheduleDetailDto> => getSchedule(scheduleId, signal),
      [scheduleId],
    ),
  );
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <ListSkeleton rows={4} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="This schedule could not be loaded"
        description={describeRequestError(state.error)}
        onRetry={reload}
      />
    );
  }
  const detail = state.data;
  const { schedule } = detail;
  const status = SCHEDULE_STATUS_PRESENTATION[schedule.status];
  const archived = schedule.status === 'archived';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Expected {schedule.type === 'income' ? 'in' : 'out'}
          </p>
          <FinancialAmount
            amountMinor={schedule.amountMinor}
            currency={schedule.currency}
            direction={schedule.type === 'income' ? 'credit' : 'debit'}
            size="lg"
          />
        </div>
        <StatusBadge tone={status.tone}>
          {schedule.cancelledAt === undefined ? status.label : 'Cancelled'}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-1 gap-3 text-sm min-[400px]:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Repeats</dt>
          <dd>{describeFrequency(schedule)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Account</dt>
          <dd>{detail.account?.name ?? 'Chosen when recording'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{detail.category?.name ?? 'Chosen when recording'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dates</dt>
          <dd>
            From {formatDate(schedule.startDate, 'dayMonthYear')}
            {schedule.endDate === undefined
              ? ''
              : ` to ${formatDate(schedule.endDate, 'dayMonthYear')}`}
          </dd>
        </div>
        {schedule.merchant !== undefined && (
          <div>
            <dt className="text-muted-foreground">
              {schedule.type === 'income' ? 'From' : 'Paid to'}
            </dt>
            <dd>{schedule.merchant}</dd>
          </div>
        )}
        {schedule.notes !== undefined && (
          <div className="min-[400px]:col-span-2">
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-line">{schedule.notes}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="schedule-next-heading" className="flex flex-col gap-1">
        <h3 id="schedule-next-heading" className="text-sm font-semibold">
          Still expected
        </h3>
        {detail.upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {schedule.status === 'paused' ? 'Nothing while paused.' : 'Nothing left to expect.'}
          </p>
        ) : (
          <OccurrenceList
            label="Payments still expected"
            items={detail.upcoming.map((occurrence) => asUpcoming(detail, occurrence))}
            today={detail.today}
            actions={actions}
          />
        )}
      </section>

      <section aria-labelledby="schedule-history-heading" className="flex flex-col gap-1">
        <h3 id="schedule-history-heading" className="text-sm font-semibold">
          History
        </h3>
        {detail.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded or skipped yet.</p>
        ) : (
          <OccurrenceList
            label="Recorded and skipped payments"
            items={detail.history.map((occurrence) => asUpcoming(detail, occurrence))}
            today={detail.today}
            actions={actions}
          />
        )}
      </section>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
        {archived ? (
          <Button
            className="h-11 sm:h-10"
            onClick={() => {
              onLifecycle(detail, 'restore');
            }}
          >
            <ArchiveRestore aria-hidden="true" />
            Restore
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => {
                onLifecycle(detail, 'archive');
              }}
            >
              <Archive aria-hidden="true" />
              Archive
            </Button>
            {schedule.status !== 'completed' && schedule.cancelledAt === undefined && (
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                onClick={() => {
                  onLifecycle(detail, 'end');
                }}
              >
                <Square aria-hidden="true" />
                {schedule.isSubscription ? 'Cancel subscription' : 'End'}
              </Button>
            )}
            {schedule.status === 'paused' ? (
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                onClick={() => {
                  onLifecycle(detail, 'resume');
                }}
              >
                <CirclePlay aria-hidden="true" />
                Resume
              </Button>
            ) : schedule.status === 'active' ? (
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                onClick={() => {
                  onLifecycle(detail, 'pause');
                }}
              >
                <CirclePause aria-hidden="true" />
                Pause
              </Button>
            ) : null}
            <Button
              className="h-11 sm:h-10"
              onClick={() => {
                onEdit(detail);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export interface ScheduleDetailsSheetProps {
  scheduleId: string | undefined;
  title: string;
  /** Bumped by the parent after any change, so the details reload. */
  version: number;
  actions: OccurrenceActions;
  onClose: () => void;
  onEdit: (item: RecurringScheduleItemDto) => void;
  onLifecycle: (item: RecurringScheduleItemDto, action: ScheduleLifecycle) => void;
}

/** A schedule's rule, what is still expected, and what already happened. */
export function ScheduleDetailsSheet({
  scheduleId,
  title,
  version,
  actions,
  onClose,
  onEdit,
  onLifecycle,
}: ScheduleDetailsSheetProps): ReactNode {
  return (
    <SideSheet open={scheduleId !== undefined} onClose={onClose} title={title}>
      {scheduleId !== undefined && (
        <Details
          // Remounted (and reloaded) whenever the parent reports a change.
          key={`${scheduleId}:${String(version)}`}
          scheduleId={scheduleId}
          actions={actions}
          onEdit={onEdit}
          onLifecycle={onLifecycle}
        />
      )}
    </SideSheet>
  );
}
