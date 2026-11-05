'use client';

import type { AccountDto, CategoryDto, UpcomingOccurrenceDto } from '@calmcash/shared';
import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { SideSheet } from '@/components/layout/side-sheet';
import { formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { skipOccurrence } from '@/services/recurring.service';

import { LinkExistingPayment } from './components/link-existing-payment';
import { PostponeForm, RecordOccurrenceForm } from './components/occurrence-forms';
import type { OccurrenceActions } from './components/occurrence-list';

export type PlanningNotice = { tone: 'success' | 'error'; message: string } | undefined;

export interface OccurrenceActionsController {
  actions: OccurrenceActions;
  /** The record and postpone sheets and the skip confirmation; render once. */
  overlays: ReactNode;
}

/**
 * Record, skip, restore, and postpone for any list of occurrences, with one set of sheets. After
 * every change it calls `onChanged` so the list reloads from the API (never patched locally).
 */
export function useOccurrenceActions({
  accounts,
  categories,
  timeZone,
  onChanged,
  onNotice,
  onOpenSchedule,
}: {
  accounts: readonly AccountDto[];
  categories: readonly CategoryDto[];
  timeZone: string;
  onChanged: () => void;
  onNotice: (notice: PlanningNotice) => void;
  onOpenSchedule: (scheduleId: string) => void;
}): OccurrenceActionsController {
  const [recording, setRecording] = useState<UpcomingOccurrenceDto | undefined>();
  const [postponing, setPostponing] = useState<UpcomingOccurrenceDto | undefined>();
  const [skipping, setSkipping] = useState<UpcomingOccurrenceDto | undefined>();

  const skip = async (item: UpcomingOccurrenceDto, action: 'skip' | 'unskip'): Promise<void> => {
    onNotice(undefined);
    try {
      await skipOccurrence(item.occurrence.scheduleId, item.occurrence.scheduledDate, action);
      onNotice({
        tone: 'success',
        message:
          action === 'skip'
            ? `${item.schedule.name} on ${formatDate(item.occurrence.dueDate, 'dayMonth')} was skipped. Nothing was recorded.`
            : `${item.schedule.name} on ${formatDate(item.occurrence.scheduledDate, 'dayMonth')} is expected again.`,
      });
      onChanged();
    } catch (error: unknown) {
      onNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  const actions: OccurrenceActions = {
    onRecord: (item) => {
      onNotice(undefined);
      setRecording(item);
    },
    onPostpone: (item) => {
      onNotice(undefined);
      setPostponing(item);
    },
    onSkip: setSkipping,
    onUnskip: (item) => void skip(item, 'unskip'),
    onOpenSchedule,
  };

  const overlays = (
    <>
      <SideSheet
        open={recording !== undefined}
        onClose={() => {
          setRecording(undefined);
        }}
        title={recording === undefined ? 'Record payment' : `Record ${recording.schedule.name}`}
        description="Confirm what actually happened. Only this creates a transaction."
      >
        {recording !== undefined && (
          <div
            key={`${recording.occurrence.scheduleId}:${recording.occurrence.scheduledDate}`}
            className="flex flex-col gap-5"
          >
            <LinkExistingPayment
              target={recording}
              timeZone={timeZone}
              onLinked={(result) => {
                setRecording(undefined);
                onNotice({
                  tone: 'success',
                  message: `${recording.schedule.name} is settled by ${result.transaction.transaction.description} (${formatMoney(result.transaction.transaction.amountMinor, result.transaction.transaction.currency)}). Nothing new was recorded.`,
                });
                onChanged();
              }}
            />
            <RecordOccurrenceForm
              target={recording}
              accounts={accounts}
              categories={categories}
              timeZone={timeZone}
              onCancel={() => {
                setRecording(undefined);
              }}
              onRecorded={(result) => {
                setRecording(undefined);
                onNotice({
                  tone: 'success',
                  message: `${result.transaction.transaction.description} was recorded: ${formatMoney(result.transaction.transaction.amountMinor, result.transaction.transaction.currency)} in ${result.transaction.account.name}.`,
                });
                onChanged();
              }}
            />
          </div>
        )}
      </SideSheet>

      <SideSheet
        open={postponing !== undefined}
        onClose={() => {
          setPostponing(undefined);
        }}
        title={postponing === undefined ? 'Postpone' : `Postpone ${postponing.schedule.name}`}
      >
        {postponing !== undefined && (
          <PostponeForm
            target={postponing}
            timeZone={timeZone}
            onCancel={() => {
              setPostponing(undefined);
            }}
            onPostponed={(result) => {
              setPostponing(undefined);
              onNotice({
                tone: 'success',
                message: `Now due ${formatDate(result.occurrence.dueDate, 'dayMonthYear')}.`,
              });
              onChanged();
            }}
          />
        )}
      </SideSheet>

      <ConfirmDialog
        open={skipping !== undefined}
        onOpenChange={(open) => {
          if (!open) setSkipping(undefined);
        }}
        title={
          skipping === undefined ? 'Skip this time?' : `Skip ${skipping.schedule.name} this time?`
        }
        description="Nothing is recorded and no money moves. The next one stays on schedule, and you can undo this with “Expect it after all”."
        confirmLabel="Skip"
        onConfirm={() => {
          const target = skipping;
          setSkipping(undefined);
          if (target !== undefined) void skip(target, 'skip');
        }}
      />
    </>
  );

  return { actions, overlays };
}
