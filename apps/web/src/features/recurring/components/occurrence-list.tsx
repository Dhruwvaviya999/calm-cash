'use client';

import type { IsoDateString, UpcomingOccurrenceDto } from '@calmcash/shared';
import {
  CalendarClock,
  CalendarX2,
  Check,
  Ellipsis,
  Eye,
  ReceiptText,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  describeDue,
  isPendingOccurrence,
  occurrenceKey,
  OCCURRENCE_STATUS_PRESENTATION,
} from '../recurring-presentation';

export interface OccurrenceActions {
  onRecord: (item: UpcomingOccurrenceDto) => void;
  onSkip: (item: UpcomingOccurrenceDto) => void;
  onUnskip: (item: UpcomingOccurrenceDto) => void;
  onPostpone: (item: UpcomingOccurrenceDto) => void;
  onOpenSchedule: (scheduleId: string) => void;
}

/**
 * One occurrence: when it is due, what and how much, and what can be done. Expected amounts are
 * labelled as expected and shown muted; only recorded ones are money that moved.
 */
export function OccurrenceRow({
  item,
  today,
  actions,
  compact = false,
}: {
  item: UpcomingOccurrenceDto;
  today: IsoDateString;
  actions?: OccurrenceActions | undefined;
  /** Without actions and secondary lines (dashboard preview). */
  compact?: boolean;
}): ReactNode {
  const { occurrence, schedule, account } = item;
  const pending = isPendingOccurrence(occurrence);
  const status = OCCURRENCE_STATUS_PRESENTATION[occurrence.status];
  const income = schedule.type === 'income';
  const day = Number(occurrence.dueDate.slice(8));

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
      <div
        aria-hidden="true"
        className={cn(
          'grid w-11 shrink-0 place-items-center rounded-lg border py-1 text-center',
          occurrence.status === 'overdue' && 'border-expense/40 bg-expense/5',
        )}
      >
        <span className="text-base leading-tight font-semibold tabular-nums">{day}</span>
        <span className="text-2xs leading-tight text-muted-foreground uppercase">
          {formatDate(occurrence.dueDate, 'monthShort')}
        </span>
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium">{schedule.name}</p>
          <span className={cn('shrink-0 text-right', pending && 'opacity-80')}>
            {pending && <span className="mr-1 text-xs text-muted-foreground">Expected</span>}
            <FinancialAmount
              amountMinor={occurrence.amountMinor}
              currency={occurrence.currency}
              direction={income ? 'credit' : 'debit'}
              size="sm"
              className={cn(pending && 'text-foreground')}
            />
          </span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          <span className="sr-only">Due </span>
          {formatDate(occurrence.dueDate, 'dayMonthYear')}
          {pending ? ` · ${describeDue(occurrence.dueDate, today)}` : ''}
          {account === undefined ? '' : ` · ${account.name}`}
        </p>
        {!compact && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {occurrence.postponed && (
              <span className="text-xs text-muted-foreground">
                Postponed from {formatDate(occurrence.scheduledDate, 'dayMonth')}
              </span>
            )}
            {occurrence.dueSoon && <span className="text-xs text-warning-text">Due soon</span>}
            {schedule.isSubscription && (
              <span className="text-xs text-muted-foreground">Subscription</span>
            )}
            {occurrence.transactionStatus === 'voided' && (
              <span className="text-xs text-muted-foreground">Transaction voided</span>
            )}
          </div>
        )}
        {compact && (
          <div className="mt-1">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
        )}
      </div>
      {actions !== undefined && !compact && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {pending && (
            <Button
              size="sm"
              variant={occurrence.status === 'upcoming' ? 'outline' : 'default'}
              className="h-10"
              aria-label={`Record ${schedule.name}`}
              onClick={() => {
                actions.onRecord(item);
              }}
            >
              <Check aria-hidden="true" />
              Record
            </Button>
          )}
          {occurrence.transactionId !== undefined && (
            <Button asChild size="sm" variant="ghost" className="h-10">
              <Link
                href={{
                  pathname: '/transactions',
                  query: { transaction: occurrence.transactionId },
                }}
              >
                <ReceiptText aria-hidden="true" />
                <span className="max-sm:sr-only">Transaction</span>
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-full"
                aria-label={`More for ${schedule.name} on ${formatDate(occurrence.dueDate, 'dayMonthYear')}`}
              >
                <Ellipsis aria-hidden="true" className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {pending && (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      actions.onPostpone(item);
                    }}
                  >
                    <CalendarClock aria-hidden="true" />
                    Postpone
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      actions.onSkip(item);
                    }}
                  >
                    <CalendarX2 aria-hidden="true" />
                    Skip this time
                  </DropdownMenuItem>
                </>
              )}
              {(occurrence.status === 'skipped' || occurrence.status === 'paused') && (
                <DropdownMenuItem
                  onSelect={() => {
                    actions.onUnskip(item);
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                  Expect it after all
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  actions.onOpenSchedule(schedule.id);
                }}
              >
                <Eye aria-hidden="true" />
                View schedule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

export function OccurrenceList({
  items,
  today,
  actions,
  compact = false,
  label,
}: {
  items: readonly UpcomingOccurrenceDto[];
  today: IsoDateString;
  actions?: OccurrenceActions | undefined;
  compact?: boolean;
  /** Accessible name of the list. */
  label: string;
}): ReactNode {
  return (
    <ul aria-label={label} className="flex flex-col divide-y">
      {items.map((item) => (
        <li key={occurrenceKey(item.occurrence)}>
          <OccurrenceRow item={item} today={today} actions={actions} compact={compact} />
        </li>
      ))}
    </ul>
  );
}
