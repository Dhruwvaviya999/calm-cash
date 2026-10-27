'use client';

import {
  addDaysToIsoDate,
  budgetPeriodContaining,
  startOfIsoWeek,
  type IsoDateString,
  type UpcomingOccurrenceDto,
} from '@calmcash/shared';
import type { ReactNode } from 'react';

import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { isPendingOccurrence } from '../recurring-presentation';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function describeDay(date: IsoDateString, items: readonly UpcomingOccurrenceDto[]): string {
  const overdue = items.filter((item) => item.occurrence.status === 'overdue').length;
  const pending = items.filter((item) => isPendingOccurrence(item.occurrence)).length;
  const parts = [formatDate(date, 'fullDate')];
  if (items.length === 0) {
    parts.push('nothing due');
  } else {
    parts.push(`${String(items.length)} ${items.length === 1 ? 'payment' : 'payments'}`);
    if (pending > 0) parts.push(`${String(pending)} expected`);
    if (overdue > 0) parts.push(`${String(overdue)} overdue`);
  }
  return parts.join(', ');
}

/**
 * A month of due dates, weeks starting on Monday. Each day is a button that selects it; the
 * selected day's payments are listed below the grid by the caller. Seven columns of 2.5rem fit a
 * 320px screen, so nothing scrolls sideways.
 */
export function BillCalendar({
  month,
  items,
  today,
  selected,
  onSelect,
}: {
  /** Any date in the month to show. */
  month: IsoDateString;
  items: readonly UpcomingOccurrenceDto[];
  today: IsoDateString;
  selected: IsoDateString | undefined;
  onSelect: (date: IsoDateString) => void;
}): ReactNode {
  const range = budgetPeriodContaining('monthly', month);
  const first = startOfIsoWeek(range.from);
  const days: IsoDateString[] = [];
  for (
    let date = first;
    date <= range.to || days.length % 7 !== 0;
    date = addDaysToIsoDate(date, 1)
  ) {
    days.push(date);
  }
  const byDay = new Map<IsoDateString, UpcomingOccurrenceDto[]>();
  for (const item of items) {
    byDay.set(item.occurrence.dueDate, [...(byDay.get(item.occurrence.dueDate) ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        aria-hidden="true"
        className="grid grid-cols-7 text-center text-xs text-muted-foreground"
      >
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <ul
        aria-label={`Payments in ${formatDate(range.from, 'monthYear')}`}
        className="grid grid-cols-7 gap-1"
      >
        {days.map((date) => {
          const inMonth = date >= range.from && date <= range.to;
          const entries = byDay.get(date) ?? [];
          const overdue = entries.some((entry) => entry.occurrence.status === 'overdue');
          const pending = entries.some((entry) => isPendingOccurrence(entry.occurrence));
          const isSelected = date === selected;
          return (
            <li key={date} className="min-w-0">
              {inMonth ? (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={describeDay(date, entries)}
                  onClick={() => {
                    onSelect(date);
                  }}
                  className={cn(
                    'flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg border text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-14',
                    isSelected
                      ? 'border-primary bg-accent'
                      : 'border-transparent hover:bg-muted/60',
                    date === today && 'font-semibold',
                  )}
                >
                  <span
                    className={cn(
                      date === today && 'rounded-full bg-primary px-1.5 text-primary-foreground',
                    )}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {entries.length > 0 && (
                    <span aria-hidden="true" className="flex items-center gap-0.5">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          overdue
                            ? 'bg-expense'
                            : pending
                              ? 'bg-primary'
                              : 'bg-muted-foreground/60',
                        )}
                      />
                      {entries.length > 1 && (
                        <span className="text-2xs leading-none text-muted-foreground">
                          {entries.length}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              ) : (
                <span aria-hidden="true" className="block h-12 sm:h-14" />
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" /> Expected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-expense" /> Overdue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/60" />{' '}
          Recorded or skipped
        </span>
      </p>
    </div>
  );
}
