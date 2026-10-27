'use client';

import {
  addDaysToIsoDate,
  budgetPeriodContaining,
  calendarDateInTimeZone,
  CURRENCIES,
  shiftBudgetPeriod,
  type RecurringScheduleItemDto,
  type RecurringScheduleListDto,
  type UpcomingOccurrencesDto,
} from '@calmcash/shared';
import { CalendarClock, ChevronLeft, ChevronRight, Eye, Plus, Repeat } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { FilterOptions } from '@/components/forms/filter-bar';
import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  changeSchedule,
  endSchedule,
  getUpcomingOccurrences,
  listSchedules,
} from '@/services/recurring.service';
import { cancelSubscription } from '@/services/subscriptions.service';

import {
  describeDue,
  describeFrequency,
  SCHEDULE_STATUS_PRESENTATION,
} from '../recurring-presentation';
import { useOccurrenceActions, type PlanningNotice } from '../use-occurrence-actions';
import { usePlanningReferences } from '../use-planning-references';
import { BillCalendar } from './bill-calendar';
import { OccurrenceList } from './occurrence-list';
import { ScheduleDetailsSheet, type ScheduleLifecycle } from './schedule-details-sheet';
import { ScheduleForm, type ScheduleFormMode } from './schedule-form';

type View = 'upcoming' | 'calendar' | 'schedules';

const VIEW_OPTIONS = [
  { value: 'upcoming', label: 'Coming up' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'schedules', label: 'All schedules' },
] as const;

/** Expected totals per currency, labelled as plans. */
function ExpectedTotals({ data }: { data: UpcomingOccurrencesDto }): ReactNode {
  if (data.pendingTotals.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Expected totals">
      {data.pendingTotals.map((total) => (
        <li key={total.currency} className="min-w-0 rounded-xl border bg-muted/30 p-4">
          {data.pendingTotals.length > 1 && (
            <p className="mb-2 text-sm font-medium">{CURRENCIES[total.currency].name}</p>
          )}
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">Expected out</dt>
              <dd>
                <FinancialAmount
                  amountMinor={total.expectedExpenseMinor}
                  currency={total.currency}
                  size="md"
                />
                <span className="block text-xs text-muted-foreground">
                  {total.expenseCount} {total.expenseCount === 1 ? 'payment' : 'payments'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected in</dt>
              <dd>
                <FinancialAmount
                  amountMinor={total.expectedIncomeMinor}
                  currency={total.currency}
                  size="md"
                />
                <span className="block text-xs text-muted-foreground">
                  {total.incomeCount} {total.incomeCount === 1 ? 'receipt' : 'receipts'}
                </span>
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function ScheduleCard({
  item,
  today,
  onOpen,
}: {
  item: RecurringScheduleItemDto;
  today: string;
  onOpen: () => void;
}): ReactNode {
  const { schedule, nextOccurrence, account } = item;
  const status = SCHEDULE_STATUS_PRESENTATION[schedule.status];
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{schedule.name}</h3>
          <p className="text-sm text-muted-foreground">{describeFrequency(schedule)}</p>
        </div>
        <FinancialAmount
          amountMinor={schedule.amountMinor}
          currency={schedule.currency}
          direction={schedule.type === 'income' ? 'credit' : 'debit'}
          size="sm"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {schedule.isSubscription && <span>Subscription</span>}
          {nextOccurrence !== undefined && (
            <span>
              Next: {formatDate(nextOccurrence.dueDate, 'dayMonth')} (
              {describeDue(nextOccurrence.dueDate, today).toLowerCase()})
            </span>
          )}
          {account !== undefined && <span>· {account.name}</span>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-10"
          aria-label={`Details for ${schedule.name}`}
          onClick={onOpen}
        >
          <Eye aria-hidden="true" />
          Details
        </Button>
      </div>
    </Card>
  );
}

/**
 * Bills and income that repeat: what is coming up and overdue, a month calendar, and every
 * schedule. Expected amounts are plans; only "Record" turns one into a real transaction.
 */
export function RecurringOverview(): ReactNode {
  const { user } = useSignedInSession();
  const today = calendarDateInTimeZone(new Date(), user.timezone);
  const [view, setView] = useState<View>('upcoming');
  const [month, setMonth] = useState(today);
  const [selectedDay, setSelectedDay] = useState<string | undefined>(today);
  const [archived, setArchived] = useState(false);
  const [notice, setNotice] = useState<PlanningNotice>();
  const [formMode, setFormMode] = useState<ScheduleFormMode | undefined>();
  const [detailsId, setDetailsId] = useState<string | undefined>();
  const [detailsTitle, setDetailsTitle] = useState('Schedule');
  const [version, setVersion] = useState(0);
  const [ending, setEnding] = useState<RecurringScheduleItemDto | undefined>();
  const { references } = usePlanningReferences();

  const range =
    view === 'calendar'
      ? budgetPeriodContaining('monthly', month)
      : { from: today, to: addDaysToIsoDate(today, 30) };
  const upcomingQuery = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const upcoming = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<UpcomingOccurrencesDto> =>
        getUpcomingOccurrences(upcomingQuery, signal),
      [upcomingQuery],
    ),
  );
  const schedules = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<RecurringScheduleListDto> =>
        listSchedules(`status=${archived ? 'archived' : 'current'}`, signal),
      [archived],
    ),
  );

  const changed = (): void => {
    upcoming.refresh();
    schedules.refresh();
    setVersion((current) => current + 1);
  };

  const openSchedule = (scheduleId: string): void => {
    const known =
      schedules.state.status === 'success'
        ? schedules.state.data.schedules.find((item) => item.schedule.id === scheduleId)
        : undefined;
    setDetailsTitle(known?.schedule.name ?? 'Schedule');
    setDetailsId(scheduleId);
  };

  const { actions, overlays } = useOccurrenceActions({
    accounts: references.accounts,
    categories: references.categories,
    timeZone: user.timezone,
    onChanged: changed,
    onNotice: setNotice,
    onOpenSchedule: openSchedule,
  });

  const lifecycle = async (
    item: RecurringScheduleItemDto,
    action: ScheduleLifecycle,
  ): Promise<void> => {
    if (action === 'end') {
      setEnding(item);
      return;
    }
    setNotice(undefined);
    try {
      const result = await changeSchedule(item.schedule.id, action);
      const words: Readonly<Record<typeof action, string>> = {
        pause: 'is paused. Nothing is expected until you resume it.',
        resume: 'is active again. Payments that fell while paused are not owed.',
        archive: 'was archived. Its history is kept.',
        restore: 'was restored.',
      };
      setNotice({ tone: 'success', message: `${result.schedule.name} ${words[action]}` });
      changed();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  const openCreate = (): void => {
    setNotice(undefined);
    setFormMode({ kind: 'create', variant: 'schedule' });
  };

  let content: ReactNode;
  if (view === 'schedules') {
    content =
      schedules.state.status === 'loading' ? (
        <ListSkeleton rows={4} />
      ) : schedules.state.status === 'error' ? (
        <ErrorState
          title="Your schedules could not be loaded"
          description={describeRequestError(schedules.state.error)}
          onRetry={schedules.reload}
        />
      ) : schedules.state.data.schedules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={archived ? 'No archived schedules' : 'No recurring payments yet'}
          description={
            archived
              ? 'Schedules you archive appear here with their history.'
              : 'Add rent, salary, bills, or insurance once, and CalmCash lists each one when it is due.'
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {schedules.state.data.schedules.map((item) => (
            <li key={item.schedule.id} className="min-w-0">
              <ScheduleCard
                item={item}
                today={schedules.state.status === 'success' ? schedules.state.data.today : today}
                onOpen={() => {
                  setDetailsTitle(item.schedule.name);
                  setDetailsId(item.schedule.id);
                }}
              />
            </li>
          ))}
        </ul>
      );
  } else if (upcoming.state.status === 'loading') {
    content = <ListSkeleton rows={5} />;
  } else if (upcoming.state.status === 'error') {
    content = (
      <ErrorState
        title="Upcoming payments could not be loaded"
        description={describeRequestError(upcoming.state.error)}
        onRetry={upcoming.reload}
      />
    );
  } else {
    const data = upcoming.state.data;
    const overdue = data.items.filter((item) => item.occurrence.status === 'overdue');
    const rest = data.items.filter((item) => item.occurrence.status !== 'overdue');
    const noSchedules =
      schedules.state.status === 'success' &&
      schedules.state.data.schedules.length === 0 &&
      !archived;
    if (noSchedules) {
      content = (
        <EmptyState
          icon={CalendarClock}
          title="Nothing scheduled yet"
          description="Add a recurring payment such as rent or a salary. You will see it here when it is due, and record it with one tap when it happens."
        >
          <Button size="lg" className="h-11" onClick={openCreate}>
            <Plus aria-hidden="true" />
            Add a recurring payment
          </Button>
        </EmptyState>
      );
    } else if (view === 'calendar') {
      const dayItems = data.items.filter((item) => item.occurrence.dueDate === selectedDay);
      content = (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                aria-label="Previous month"
                onClick={() => {
                  setMonth(shiftBudgetPeriod('monthly', month, -1));
                  setSelectedDay(undefined);
                }}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <p className="text-sm font-medium" aria-live="polite">
                {formatDate(month, 'monthYear')}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="size-10"
                aria-label="Next month"
                onClick={() => {
                  setMonth(shiftBudgetPeriod('monthly', month, 1));
                  setSelectedDay(undefined);
                }}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <BillCalendar
              month={month}
              items={data.items.filter(
                (item) =>
                  item.occurrence.dueDate >= range.from && item.occurrence.dueDate <= range.to,
              )}
              today={data.today}
              selected={selectedDay}
              onSelect={setSelectedDay}
            />
          </Card>
          <div className="flex flex-col gap-4">
            {overdue.length > 0 && (
              <section aria-labelledby="calendar-overdue-heading">
                <h3 id="calendar-overdue-heading" className="text-sm font-semibold text-expense">
                  Overdue ({overdue.length})
                </h3>
                <OccurrenceList
                  label="Overdue payments"
                  items={overdue}
                  today={data.today}
                  actions={actions}
                />
              </section>
            )}
            <section aria-labelledby="calendar-day-heading">
              <h3 id="calendar-day-heading" className="text-sm font-semibold">
                {selectedDay === undefined ? 'Choose a day' : formatDate(selectedDay, 'fullDate')}
              </h3>
              {selectedDay !== undefined && dayItems.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Nothing due on this day.</p>
              ) : (
                <OccurrenceList
                  label="Payments on the selected day"
                  items={dayItems}
                  today={data.today}
                  actions={actions}
                />
              )}
            </section>
          </div>
        </div>
      );
    } else {
      content = (
        <div className="flex flex-col gap-5">
          <ExpectedTotals data={data} />
          <p className="text-xs text-muted-foreground">
            Expected amounts are plans, not money that moved. Overdue payments stay listed until you
            record or skip them.
          </p>
          {overdue.length > 0 && (
            <section aria-labelledby="overdue-heading" className="flex flex-col">
              <h3 id="overdue-heading" className="text-sm font-semibold text-expense">
                Overdue ({overdue.length})
              </h3>
              <OccurrenceList
                label="Overdue payments"
                items={overdue}
                today={data.today}
                actions={actions}
              />
            </section>
          )}
          <section aria-labelledby="next-heading" className="flex flex-col">
            <h3 id="next-heading" className="text-sm font-semibold">
              Next 30 days
            </h3>
            {rest.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">Nothing due in the next 30 days.</p>
            ) : (
              <OccurrenceList
                label="Payments in the next 30 days"
                items={rest}
                today={data.today}
                actions={actions}
              />
            )}
          </section>
          {data.truncated && (
            <p className="text-xs text-muted-foreground">
              Showing the first {data.items.length} payments.
            </p>
          )}
        </div>
      );
    }
  }

  return (
    <section aria-labelledby="recurring-heading" className="flex flex-col gap-5">
      <SectionHeader
        id="recurring-heading"
        title="Bills & recurring"
        description="Payments and income that repeat. Record each one when it actually happens."
        action={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            Add recurring
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterOptions
          legend="View"
          name="recurring-view"
          options={VIEW_OPTIONS}
          value={view}
          onValueChange={(next) => {
            setNotice(undefined);
            setView(next);
          }}
        />
        {view === 'schedules' && (
          <FilterOptions
            legend="Show schedules"
            name="recurring-status"
            options={[
              { value: 'current', label: 'Current' },
              { value: 'archived', label: 'Archived' },
            ]}
            value={archived ? 'archived' : 'current'}
            onValueChange={(next) => {
              setArchived(next === 'archived');
            }}
          />
        )}
      </div>

      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}

      <div aria-busy={upcoming.state.status === 'loading'}>{content}</div>

      {overlays}

      <SideSheet
        open={formMode !== undefined}
        onClose={() => {
          setFormMode(undefined);
        }}
        title={
          formMode?.kind === 'edit'
            ? `Edit ${formMode.item.schedule.name}`
            : 'Add a recurring payment'
        }
        description="A plan for money that moves regularly. Saving it records nothing."
      >
        {formMode !== undefined && (
          <ScheduleForm
            key={formMode.kind === 'edit' ? formMode.item.schedule.id : 'create'}
            mode={formMode}
            accounts={references.accounts}
            categories={references.categories}
            defaultCurrency={user.preferredCurrency}
            timeZone={user.timezone}
            onCancel={() => {
              setFormMode(undefined);
            }}
            onSaved={(item) => {
              setFormMode(undefined);
              setNotice({ tone: 'success', message: `${item.schedule.name} was saved.` });
              changed();
            }}
          />
        )}
      </SideSheet>

      <ScheduleDetailsSheet
        scheduleId={detailsId}
        title={detailsTitle}
        version={version}
        actions={actions}
        onClose={() => {
          setDetailsId(undefined);
        }}
        onEdit={(item) => {
          setDetailsId(undefined);
          setFormMode({ kind: 'edit', item });
        }}
        onLifecycle={(item, action) => void lifecycle(item, action)}
      />

      <ConfirmDialog
        open={ending !== undefined}
        onOpenChange={(open) => {
          if (!open) setEnding(undefined);
        }}
        title={
          ending === undefined
            ? 'End this schedule?'
            : ending.schedule.isSubscription
              ? `Cancel ${ending.schedule.name}?`
              : `End ${ending.schedule.name}?`
        }
        description={`Nothing is expected after today${ending === undefined ? '' : ` (${formatMoney(ending.schedule.amountMinor, ending.schedule.currency)} each time)`}. Payments already recorded stay as they are, and anything due up to today is still listed.`}
        confirmLabel={
          ending?.schedule.isSubscription === true ? 'Cancel subscription' : 'End schedule'
        }
        destructive
        onConfirm={() => {
          const target = ending;
          setEnding(undefined);
          if (target === undefined) return;
          setNotice(undefined);
          const request = target.schedule.isSubscription
            ? cancelSubscription(target.schedule.id)
            : endSchedule(target.schedule.id);
          request.then(
            (result) => {
              setNotice({ tone: 'success', message: `${result.schedule.name} ends today.` });
              changed();
            },
            (error: unknown) => {
              setNotice({ tone: 'error', message: describeRequestError(error) });
            },
          );
        }}
      />
    </section>
  );
}
