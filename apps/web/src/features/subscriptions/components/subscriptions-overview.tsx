'use client';

import {
  calendarDateInTimeZone,
  CURRENCIES,
  type SubscriptionDto,
  type SubscriptionListDto,
  type SubscriptionStatus,
  type SubscriptionSummaryDto,
  type UpcomingOccurrenceDto,
} from '@calmcash/shared';
import {
  Archive,
  ArchiveRestore,
  Check,
  CirclePause,
  CirclePlay,
  Ellipsis,
  Eye,
  MonitorPlay,
  Pencil,
  Plus,
  Square,
} from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge, type StatusTone } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { FilterOptions } from '@/components/forms/filter-bar';
import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignedInSession } from '@/features/auth';
import {
  describeDue,
  describeFrequency,
  isPendingOccurrence,
  ScheduleDetailsSheet,
  ScheduleForm,
  useOccurrenceActions,
  usePlanningReferences,
  type PlanningNotice,
  type ScheduleFormMode,
  type ScheduleLifecycle,
} from '@/features/recurring';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { useLinkedId } from '@/hooks/use-linked-id';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  cancelSubscription,
  changeSubscription,
  getSubscriptionSummary,
  listSubscriptions,
} from '@/services/subscriptions.service';

const STATUS: Readonly<Record<SubscriptionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};

interface Data {
  list: SubscriptionListDto;
  summary: SubscriptionSummaryDto;
}

function SummaryCards({ summary }: { summary: SubscriptionSummaryDto }): ReactNode {
  if (summary.currencies.length === 0) return null;
  return (
    <ul className="grid gap-3 lg:grid-cols-2" aria-label="Estimated subscription costs">
      {summary.currencies.map((entry) => (
        <li key={entry.currency} className="min-w-0 rounded-xl border bg-muted/30 p-4">
          <p className="mb-3 text-sm font-medium">
            {entry.activeCount} active · {CURRENCIES[entry.currency].name}
          </p>
          <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Next 30 days</dt>
              <dd>
                <FinancialAmount
                  amountMinor={entry.next30Days.amountMinor}
                  currency={entry.currency}
                  size="md"
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Next 12 months</dt>
              <dd>
                <FinancialAmount
                  amountMinor={entry.next12Months.amountMinor}
                  currency={entry.currency}
                  size="md"
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Overdue</dt>
              <dd>
                <FinancialAmount
                  amountMinor={entry.overdueMinor}
                  currency={entry.currency}
                  size="md"
                />
                <span className="block text-xs text-muted-foreground">
                  {entry.overdueCount} unrecorded
                </span>
              </dd>
            </div>
          </dl>
        </li>
      ))}
      <li className="text-xs text-muted-foreground lg:col-span-2">
        Estimates: each subscription’s amount times the charges its schedule expects. Not money
        already spent, and never added across currencies.
      </li>
    </ul>
  );
}

function asUpcoming(item: SubscriptionDto): UpcomingOccurrenceDto | undefined {
  if (item.nextOccurrence === undefined) return undefined;
  return {
    occurrence: item.nextOccurrence,
    schedule: item.schedule,
    ...(item.account === undefined ? {} : { account: item.account }),
    ...(item.category === undefined ? {} : { category: item.category }),
  };
}

/**
 * Subscriptions the person tracks: cost, billing rhythm, next charge, and a twelve-month estimate.
 * They are recurring expense schedules, so recording a charge works exactly like a bill.
 */
export function SubscriptionsOverview(): ReactNode {
  const { user } = useSignedInSession();
  const today = calendarDateInTimeZone(new Date(), user.timezone);
  const [archived, setArchived] = useState(false);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<PlanningNotice>();
  const [formMode, setFormMode] = useState<ScheduleFormMode | undefined>();
  // A renewal reminder links here with `?schedule=`; the sheet loads it (and explains if it is gone).
  const [detailsId, setDetailsId] = useState<string | undefined>(useLinkedId('schedule'));
  const [cancelling, setCancelling] = useState<SubscriptionDto | undefined>();
  const { references } = usePlanningReferences();

  const { state, reload, refresh } = useAsyncResource(
    useCallback(
      async (signal: AbortSignal): Promise<Data> => {
        const [list, summary] = await Promise.all([
          listSubscriptions(archived ? 'archived' : 'current', signal),
          getSubscriptionSummary(signal),
        ]);
        return { list, summary };
      },
      [archived],
    ),
  );
  const changed = (): void => {
    refresh();
    setVersion((current) => current + 1);
  };
  const subscriptions = state.status === 'success' ? state.data.list.subscriptions : [];
  const details = subscriptions.find((item) => item.schedule.id === detailsId);

  const { actions, overlays } = useOccurrenceActions({
    accounts: references.accounts,
    categories: references.categories,
    timeZone: user.timezone,
    onChanged: changed,
    onNotice: setNotice,
    onOpenSchedule: setDetailsId,
  });

  const lifecycle = async (scheduleId: string, action: ScheduleLifecycle): Promise<void> => {
    if (action === 'end') {
      setCancelling(subscriptions.find((item) => item.schedule.id === scheduleId));
      return;
    }
    setNotice(undefined);
    try {
      const result = await changeSubscription(scheduleId, action);
      setNotice({
        tone: 'success',
        message: `${result.schedule.name}: ${STATUS[result.status].label.toLowerCase()}.`,
      });
      changed();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  const openCreate = (): void => {
    setNotice(undefined);
    setFormMode({ kind: 'create', variant: 'subscription' });
  };

  let content: ReactNode;
  if (state.status === 'loading') {
    content = <ListSkeleton rows={4} />;
  } else if (state.status === 'error') {
    content = (
      <ErrorState
        title="Your subscriptions could not be loaded"
        description={`${describeRequestError(state.error)} Nothing has been lost.`}
        onRetry={reload}
      />
    );
  } else if (subscriptions.length === 0) {
    content = archived ? (
      <EmptyState
        icon={Archive}
        title="No archived subscriptions"
        description="Subscriptions you archive appear here with their history."
      />
    ) : (
      <EmptyState
        icon={MonitorPlay}
        title="Track your subscriptions"
        description="Add streaming, software, memberships, or any regular charge. CalmCash shows when each one is next billed and what they add up to — you add them yourself; nothing is detected automatically."
      >
        <Button size="lg" className="h-11" onClick={openCreate}>
          <Plus aria-hidden="true" />
          Add a subscription
        </Button>
      </EmptyState>
    );
  } else {
    content = (
      <div className="flex flex-col gap-5">
        {!archived && <SummaryCards summary={state.data.summary} />}
        <ul className="grid gap-3 md:grid-cols-2">
          {subscriptions.map((item) => {
            const status = STATUS[item.status];
            const next = asUpcoming(item);
            return (
              <li key={item.schedule.id} className="min-w-0">
                <Card className="gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{item.schedule.name}</h3>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.schedule.merchant ?? describeFrequency(item.schedule)}
                      </p>
                    </div>
                    <FinancialAmount
                      amountMinor={item.schedule.amountMinor}
                      currency={item.schedule.currency}
                      direction="debit"
                      size="sm"
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Billing</dt>
                      <dd>{describeFrequency(item.schedule)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Next charge</dt>
                      <dd>
                        {item.nextOccurrence === undefined
                          ? '—'
                          : `${formatDate(item.nextOccurrence.dueDate, 'dayMonth')} (${describeDue(item.nextOccurrence.dueDate, today).toLowerCase()})`}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Estimated next 12 months</dt>
                      <dd>
                        <FinancialAmount
                          amountMinor={item.nextTwelveMonths.amountMinor}
                          currency={item.schedule.currency}
                          size="sm"
                        />{' '}
                        <span className="text-xs text-muted-foreground">
                          ({item.nextTwelveMonths.occurrences}{' '}
                          {item.nextTwelveMonths.occurrences === 1 ? 'charge' : 'charges'})
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    <div className="flex items-center gap-1">
                      {next !== undefined &&
                        isPendingOccurrence(next.occurrence) &&
                        next.occurrence.status !== 'upcoming' && (
                          <Button
                            size="sm"
                            className="h-10"
                            onClick={() => {
                              actions.onRecord(next);
                            }}
                          >
                            <Check aria-hidden="true" />
                            Record charge
                          </Button>
                        )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10 rounded-full"
                            aria-label={`Actions for ${item.schedule.name}`}
                          >
                            <Ellipsis aria-hidden="true" className="size-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem
                            onSelect={() => {
                              setDetailsId(item.schedule.id);
                            }}
                          >
                            <Eye aria-hidden="true" />
                            View details
                          </DropdownMenuItem>
                          {item.status === 'archived' ? (
                            <DropdownMenuItem
                              onSelect={() => void lifecycle(item.schedule.id, 'restore')}
                            >
                              <ArchiveRestore aria-hidden="true" />
                              Restore
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setFormMode({ kind: 'edit', item });
                                }}
                              >
                                <Pencil aria-hidden="true" />
                                Edit
                              </DropdownMenuItem>
                              {item.status === 'active' && (
                                <DropdownMenuItem
                                  onSelect={() => void lifecycle(item.schedule.id, 'pause')}
                                >
                                  <CirclePause aria-hidden="true" />
                                  Pause
                                </DropdownMenuItem>
                              )}
                              {item.status === 'paused' && (
                                <DropdownMenuItem
                                  onSelect={() => void lifecycle(item.schedule.id, 'resume')}
                                >
                                  <CirclePlay aria-hidden="true" />
                                  Resume
                                </DropdownMenuItem>
                              )}
                              {item.status !== 'cancelled' && (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setCancelling(item);
                                  }}
                                >
                                  <Square aria-hidden="true" />
                                  Cancel subscription
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onSelect={() => void lifecycle(item.schedule.id, 'archive')}
                              >
                                <Archive aria-hidden="true" />
                                Archive
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <section aria-labelledby="subscriptions-heading" className="flex flex-col gap-5">
      <SectionHeader
        id="subscriptions-heading"
        title="Subscriptions"
        description="Regular charges you want to keep an eye on."
        action={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            Add subscription
          </Button>
        }
      />
      <FilterOptions
        legend="Show subscriptions"
        name="subscription-status"
        options={[
          { value: 'current', label: 'Current' },
          { value: 'archived', label: 'Archived' },
        ]}
        value={archived ? 'archived' : 'current'}
        onValueChange={(next) => {
          setNotice(undefined);
          setArchived(next === 'archived');
        }}
      />
      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
      <div aria-busy={state.status === 'loading'}>{content}</div>
      {overlays}

      <SideSheet
        open={formMode !== undefined}
        onClose={() => {
          setFormMode(undefined);
        }}
        title={
          formMode?.kind === 'edit' ? `Edit ${formMode.item.schedule.name}` : 'Add a subscription'
        }
        description="Track a regular charge. Saving it records nothing; record each charge when it is billed."
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
        title={details?.schedule.name ?? 'Subscription'}
        version={version}
        actions={actions}
        onClose={() => {
          setDetailsId(undefined);
        }}
        onEdit={(item) => {
          setDetailsId(undefined);
          setFormMode({ kind: 'edit', item });
        }}
        onLifecycle={(item, action) => void lifecycle(item.schedule.id, action)}
      />

      <ConfirmDialog
        open={cancelling !== undefined}
        onOpenChange={(open) => {
          if (!open) setCancelling(undefined);
        }}
        title={
          cancelling === undefined ? 'Cancel subscription?' : `Cancel ${cancelling.schedule.name}?`
        }
        description="No charges are expected after today. Charges already recorded stay exactly as they are, and you can still archive it later."
        confirmLabel="Cancel subscription"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => {
          const target = cancelling;
          setCancelling(undefined);
          if (target === undefined) return;
          setNotice(undefined);
          cancelSubscription(target.schedule.id).then(
            (result) => {
              setNotice({ tone: 'success', message: `${result.schedule.name} is cancelled.` });
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
