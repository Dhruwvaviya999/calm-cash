'use client';

import type { BudgetWithProgressDto, TransactionPageDto } from '@calmcash/shared';
import { Archive, ArchiveRestore, ArrowRight, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';

import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { TransactionRow } from '@/features/transactions';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { describeRequestError } from '@/lib/form-errors';
import { listTransactions } from '@/services/transactions.service';

import {
  BUDGET_PERIOD_LABELS,
  budgetTransactionsHref,
  budgetTransactionsQuery,
  describeBudgetWindow,
  describeScope,
  describeThresholds,
} from '../budget-presentation';
import { BudgetProgress } from './budget-progress';

const PREVIEW_SIZE = 8;

function BudgetTransactions({
  item,
  timeZone,
}: {
  item: BudgetWithProgressDto;
  timeZone: string;
}): ReactNode {
  const query = budgetTransactionsQuery(item, PREVIEW_SIZE);
  const { state } = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<TransactionPageDto> => listTransactions(query, signal),
      [query],
    ),
  );
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading the expenses in this budget…</span>
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (state.status === 'error') {
    return <p className="text-sm text-muted-foreground">{describeRequestError(state.error)}</p>;
  }
  if (state.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No expenses in this period yet.</p>;
  }
  return (
    <ul className="flex flex-col divide-y">
      {state.data.items.map((entry) => (
        <li key={entry.transaction.id} className="py-2">
          <TransactionRow item={entry} timeZone={timeZone} />
        </li>
      ))}
    </ul>
  );
}

export interface BudgetDetailsSheetProps {
  item: BudgetWithProgressDto | undefined;
  timeZone: string;
  onClose: () => void;
  onEdit: (item: BudgetWithProgressDto) => void;
  onArchive: (item: BudgetWithProgressDto) => void;
  onRestore: (item: BudgetWithProgressDto) => void;
}

/**
 * A budget with the expenses behind its figure. The list uses the same scope as the API: active
 * expenses in the budget's currency and period, in its category and subcategories (or in every
 * category for an overall budget).
 */
export function BudgetDetailsSheet({
  item,
  timeZone,
  onClose,
  onEdit,
  onArchive,
  onRestore,
}: BudgetDetailsSheetProps): ReactNode {
  return (
    <SideSheet
      open={item !== undefined}
      onClose={onClose}
      title={item?.budget.name ?? 'Budget'}
      description={item === undefined ? undefined : describeBudgetWindow(item.progress)}
    >
      {item !== undefined && (
        <div className="flex flex-col gap-6">
          <BudgetProgress item={item} headingLevel="h3" />
          <dl className="grid grid-cols-1 gap-3 text-sm min-[400px]:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Covers</dt>
              <dd>{describeScope(item)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Repeats</dt>
              <dd>{BUDGET_PERIOD_LABELS[item.budget.period]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Alerts</dt>
              <dd>{describeThresholds(item.budget.alertThresholdsBp)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expenses counted</dt>
              <dd className="tabular-nums">{item.progress.transactionCount}</dd>
            </div>
            {item.budget.description !== undefined && (
              <div className="min-[400px]:col-span-2">
                <dt className="text-muted-foreground">Note</dt>
                <dd>{item.budget.description}</dd>
              </div>
            )}
          </dl>
          <p className="text-xs text-muted-foreground">
            Counts expenses only. Income, transfers between your accounts, balance corrections, and
            voided transactions never use up a budget.
          </p>

          <section aria-labelledby="budget-expenses-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 id="budget-expenses-heading" className="text-sm font-semibold">
                Latest expenses
              </h3>
              <Link
                href={budgetTransactionsHref(item)}
                className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                View all
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
            <BudgetTransactions item={item} timeZone={timeZone} />
          </section>

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            {item.budget.status === 'active' ? (
              <>
                <Button
                  variant="outline"
                  className="h-11 sm:h-10"
                  onClick={() => {
                    onArchive(item);
                  }}
                >
                  <Archive aria-hidden="true" />
                  Archive
                </Button>
                <Button
                  className="h-11 sm:h-10"
                  onClick={() => {
                    onEdit(item);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              </>
            ) : (
              <Button
                className="h-11 sm:h-10"
                onClick={() => {
                  onRestore(item);
                }}
              >
                <ArchiveRestore aria-hidden="true" />
                Restore
              </Button>
            )}
          </div>
        </div>
      )}
    </SideSheet>
  );
}
