'use client';

import {
  calendarDateInTimeZone,
  shiftBudgetPeriod,
  type BudgetListDto,
  type BudgetSummaryDto,
  type BudgetWithProgressDto,
  type CategoryDto,
  type CurrencyCode,
} from '@calmcash/shared';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Eye,
  List,
  Pencil,
  PiggyBank,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { useLinkedId } from '@/hooks/use-linked-id';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  archiveBudget,
  getBudgetSummary,
  listBudgets,
  restoreBudget,
} from '@/services/budgets.service';
import { listCategories } from '@/services/categories.service';

import {
  BUDGET_PERIOD_LABELS,
  budgetTransactionsHref,
  describeBudgetWindow,
} from '../budget-presentation';
import { BudgetDetailsSheet } from './budget-details-sheet';
import { BudgetForm, type BudgetFormMode } from './budget-form';
import { BudgetProgress } from './budget-progress';
import { BudgetStatusCounts, BudgetTotals } from './budget-summary';

type View = 'active' | 'archived';

const VIEW_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const;

interface BudgetsData {
  list: BudgetListDto;
  summary: BudgetSummaryDto;
  categories: CategoryDto[];
}

type Notice = { tone: 'success' | 'error'; message: string } | undefined;

function BudgetsSkeleton(): ReactNode {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading your budgets…</span>
      <Skeleton aria-hidden="true" className="h-36 rounded-2xl bg-muted" />
      <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-40 rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

function BudgetCard({
  item,
  onOpen,
  onEdit,
  onArchive,
  onRestore,
}: {
  item: BudgetWithProgressDto;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}): ReactNode {
  const active = item.budget.status === 'active';
  return (
    <Card className="gap-3 p-5">
      <BudgetProgress item={item} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {BUDGET_PERIOD_LABELS[item.budget.period]} · {describeBudgetWindow(item.progress)}
        </p>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="h-10">
            <Link href={budgetTransactionsHref(item)}>
              <List aria-hidden="true" />
              Expenses
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${item.budget.name}`}
                className="size-10 rounded-full"
              >
                <Ellipsis aria-hidden="true" className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onOpen}>
                <Eye aria-hidden="true" />
                View details
              </DropdownMenuItem>
              {active ? (
                <>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onArchive}>
                    <Archive aria-hidden="true" />
                    Archive
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={onRestore}>
                  <ArchiveRestore aria-hidden="true" />
                  Restore
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

/**
 * Budgets for a chosen month (weekly and yearly budgets show their week or year containing it):
 * totals without double counting, status counts, and one card per budget. Every figure comes
 * from the API; nothing is added up in the browser.
 */
export function BudgetsOverview(): ReactNode {
  const { user } = useSignedInSession();
  const today = calendarDateInTimeZone(new Date(), user.timezone);
  const [reference, setReference] = useState(today);
  const [view, setView] = useState<View>('active');
  const [currency, setCurrency] = useState<CurrencyCode | undefined>();

  const load = useCallback(
    async (signal: AbortSignal): Promise<BudgetsData> => {
      const summaryQuery = new URLSearchParams({ date: reference });
      if (currency !== undefined) summaryQuery.set('currency', currency);
      const listQuery = new URLSearchParams({ status: view, date: reference });
      const [list, summary, categories] = await Promise.all([
        listBudgets(listQuery.toString(), signal),
        getBudgetSummary(summaryQuery.toString(), signal),
        listCategories(signal),
      ]);
      return { list, summary, categories: categories.categories };
    },
    [reference, view, currency],
  );
  const { state, reload, refresh } = useAsyncResource(load);

  const [formMode, setFormMode] = useState<BudgetFormMode | undefined>();
  // A notification links here with `?budget=`: open that budget's details once it is loaded.
  const linkedBudget = useLinkedId('budget');
  const [detailsId, setDetailsId] = useState<string | undefined>(linkedBudget);
  const [archiveTarget, setArchiveTarget] = useState<BudgetWithProgressDto | undefined>();
  const [notice, setNotice] = useState<Notice>();

  const data = state.status === 'success' ? state.data : undefined;
  const details = data?.list.budgets.find((item) => item.budget.id === detailsId);
  const shownCurrency = data?.summary.currency;
  const multiCurrency = (data?.summary.currencies.length ?? 0) > 1;
  const budgets =
    data === undefined
      ? []
      : data.list.budgets.filter(
          (item) =>
            !multiCurrency || shownCurrency === undefined || item.budget.currency === shownCurrency,
        );
  const isCurrentMonth = reference.slice(0, 7) === today.slice(0, 7);

  const openCreate = (): void => {
    setNotice(undefined);
    setFormMode({ kind: 'create' });
  };

  const runAction = async (
    action: () => Promise<BudgetWithProgressDto>,
    success: (item: BudgetWithProgressDto) => string,
  ): Promise<void> => {
    setNotice(undefined);
    try {
      const item = await action();
      setNotice({ tone: 'success', message: success(item) });
      refresh();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  const restore = (item: BudgetWithProgressDto): void => {
    void runAction(
      () => restoreBudget(item.budget.id),
      (restored) => `${restored.budget.name} is active again.`,
    );
  };

  let content: ReactNode;
  if (state.status === 'loading') {
    content = <BudgetsSkeleton />;
  } else if (state.status === 'error') {
    content = (
      <ErrorState
        title="Your budgets could not be loaded"
        description={`${describeRequestError(state.error)} Nothing has been lost.`}
        onRetry={reload}
      />
    );
  } else if (budgets.length === 0) {
    content =
      view === 'active' ? (
        <EmptyState
          icon={PiggyBank}
          title="Create your first budget"
          description="Pick a category such as Food, set a monthly limit, and CalmCash shows how much is left — from the expenses you record, never from guesses."
        >
          <Button size="lg" className="h-11" onClick={openCreate}>
            <Plus aria-hidden="true" />
            Create a budget
          </Button>
        </EmptyState>
      ) : (
        <EmptyState
          icon={Archive}
          title="No archived budgets"
          description="Budgets you archive appear here with their settings intact. Restore one at any time."
        />
      );
  } else {
    const summary = state.data.summary;
    content = (
      <div className="flex flex-col gap-6">
        {view === 'active' && summary.currency !== undefined && summary.totals.length > 0 && (
          <section aria-label="Budget totals" className="flex flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
              {summary.totals.map((totals) => (
                <BudgetTotals
                  key={totals.period}
                  totals={totals}
                  currency={summary.currency ?? 'INR'}
                />
              ))}
            </div>
            <BudgetStatusCounts summary={summary} />
          </section>
        )}
        <ul className="grid gap-4 md:grid-cols-2">
          {budgets.map((item) => (
            <li key={item.budget.id} className="min-w-0">
              <BudgetCard
                item={item}
                onOpen={() => {
                  setDetailsId(item.budget.id);
                }}
                onEdit={() => {
                  setNotice(undefined);
                  setFormMode({ kind: 'edit', item });
                }}
                onArchive={() => {
                  setArchiveTarget(item);
                }}
                onRestore={() => {
                  restore(item);
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section aria-labelledby="budgets-heading" className="flex flex-col gap-5">
      <SectionHeader
        id="budgets-heading"
        title="Budgets"
        description="Spending limits per period, measured against the expenses you record."
        action={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            Create budget
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-1" role="group" aria-label="Budget period">
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label="Previous month"
            onClick={() => {
              setReference(shiftBudgetPeriod('monthly', reference, -1));
            }}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="min-w-32 text-center text-sm font-medium" aria-live="polite">
            {formatDate(reference, 'monthYear')}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label="Next month"
            onClick={() => {
              setReference(shiftBudgetPeriod('monthly', reference, 1));
            }}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {!isCurrentMonth && (
            <Button
              variant="link"
              className="h-10"
              onClick={() => {
                setReference(today);
              }}
            >
              This month
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {multiCurrency && data !== undefined && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Currency</span>
              <NativeSelect
                className="h-10 w-28"
                value={shownCurrency ?? ''}
                onChange={(event) => {
                  const next = data.summary.currencies.find((code) => code === event.target.value);
                  setCurrency(next);
                }}
              >
                {data.summary.currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          <FilterOptions
            legend="Show budgets"
            name="budget-view"
            options={VIEW_OPTIONS}
            value={view}
            onValueChange={(next) => {
              setNotice(undefined);
              setDetailsId(undefined);
              setView(next);
            }}
          />
        </div>
      </div>

      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
      {linkedBudget !== undefined &&
        detailsId === linkedBudget &&
        data !== undefined &&
        details === undefined && (
          <FormMessage tone="info" title="That budget is not in this list">
            It may have been archived or removed since the notification was sent. Archived budgets
            are under “Archived”.
          </FormMessage>
        )}

      <div aria-busy={state.status === 'loading'}>{content}</div>

      <SideSheet
        open={formMode !== undefined}
        onClose={() => {
          setFormMode(undefined);
        }}
        title={formMode?.kind === 'edit' ? 'Edit budget' : 'Create a budget'}
        description={
          formMode?.kind === 'edit'
            ? 'Changes apply to every period, past and future, because spending is always recalculated from your transactions.'
            : 'Set a limit for one category or for all spending. It repeats every period until you end it.'
        }
      >
        {formMode !== undefined && (
          <BudgetForm
            key={formMode.kind === 'edit' ? formMode.item.budget.id : 'create'}
            mode={formMode}
            categories={data?.categories ?? []}
            defaultCurrency={shownCurrency ?? user.preferredCurrency}
            timeZone={user.timezone}
            onCancel={() => {
              setFormMode(undefined);
            }}
            onSaved={(item) => {
              const created = formMode.kind === 'create';
              setFormMode(undefined);
              setNotice({
                tone: 'success',
                message: created
                  ? `${item.budget.name} was created.`
                  : `${item.budget.name} was updated.`,
              });
              if (view !== 'active') {
                setView('active');
              } else {
                refresh();
              }
            }}
          />
        )}
      </SideSheet>

      <BudgetDetailsSheet
        item={details}
        timeZone={user.timezone}
        onClose={() => {
          setDetailsId(undefined);
        }}
        onEdit={(item) => {
          setDetailsId(undefined);
          setFormMode({ kind: 'edit', item });
        }}
        onArchive={(item) => {
          setDetailsId(undefined);
          setArchiveTarget(item);
        }}
        onRestore={(item) => {
          setDetailsId(undefined);
          restore(item);
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(undefined);
        }}
        title={
          archiveTarget === undefined ? 'Archive budget?' : `Archive ${archiveTarget.budget.name}?`
        }
        description="It leaves your budgets and totals. Your transactions are not affected, and you can restore it at any time."
        confirmLabel="Archive budget"
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(undefined);
          if (target !== undefined) {
            void runAction(
              () => archiveBudget(target.budget.id),
              (archived) => `${archived.budget.name} was archived.`,
            );
          }
        }}
      />
    </section>
  );
}
