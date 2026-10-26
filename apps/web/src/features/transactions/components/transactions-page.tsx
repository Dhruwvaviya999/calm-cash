'use client';

import type {
  AccountWithBalanceDto,
  BulkTransactionInput,
  CategoryDto,
  TransactionListItemDto,
  TransactionPageDto,
  TransactionSummaryDto,
} from '@calmcash/shared';
import {
  ArrowLeftRight,
  CheckSquare,
  FolderTree,
  Plus,
  Scale,
  SearchX,
  SlidersHorizontal,
  WalletCards,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { FormMessage } from '@/components/forms/form-message';
import { SearchInput } from '@/components/forms/search-input';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_PRESENTATION } from '@/lib/finance-presentation';
import { describeRequestError } from '@/lib/form-errors';
import { listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import {
  bulkUpdateTransactions,
  getTransactionSummary,
  listTags,
  listTransactions,
  restoreTransaction,
  voidTransaction,
} from '@/services/transactions.service';

import {
  countActiveFilters,
  DEFAULT_FILTERS,
  listQuery,
  summaryQuery,
  withFilters,
  type TransactionFilters,
} from '../transaction-filters';
import { categoryLabel, counterpartyTitle } from '../transaction-presentation';
import { useTransactionFilters } from '../use-transaction-filters';
import { BulkActionBar, BulkEditSheet, type BulkEditAction } from './bulk-actions';
import { CategoryManagerSheet } from './category-manager-sheet';
import { TransactionDetailsSheet } from './transaction-details-sheet';
import { TransactionEntrySheet, type EntrySheetMode } from './transaction-entry-sheet';
import { TransactionFiltersSheet } from './transaction-filters-sheet';
import { TransactionHistory } from './transaction-history';
import { TransactionSummary } from './transaction-summary';
import { VoidTransactionDialog } from './void-transaction-dialog';

interface ReferenceData {
  accounts: AccountWithBalanceDto[];
  categories: CategoryDto[];
  tags: string[];
}

interface PageData {
  /** The list query the data answers, to tell when newer filters are still loading. */
  query: string;
  page: TransactionPageDto;
  summary: TransactionSummaryDto | undefined;
}

type Notice = { tone: 'success' | 'error'; message: string } | undefined;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest amount' },
  { value: 'smallest', label: 'Smallest amount' },
] as const;

function TransactionsSkeleton(): ReactNode {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading your transactions…</span>
      <div aria-hidden="true" className="grid gap-3 min-[480px]:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl bg-muted" />
        ))}
      </div>
      <div aria-hidden="true" className="rounded-2xl border bg-card px-5 py-2">
        <ListSkeleton rows={6} />
      </div>
    </div>
  );
}

const loadReferenceData = async (signal: AbortSignal): Promise<ReferenceData> => {
  const [accounts, categories, tags] = await Promise.all([
    listAccounts('all', signal),
    listCategories(signal),
    listTags(signal),
  ]);
  return {
    accounts: accounts.accounts,
    categories: categories.categories,
    tags: tags.tags.map((entry) => entry.tag),
  };
};

/** Words for the period the totals cover. */
function describeScope(filters: TransactionFilters, timeZone: string, filtered: boolean): string {
  const period =
    filters.from !== undefined && filters.to !== undefined
      ? `${formatDate(filters.from, 'dayMonthYear', timeZone)} – ${formatDate(filters.to, 'dayMonthYear', timeZone)}`
      : filters.from !== undefined
        ? `Since ${formatDate(filters.from, 'dayMonthYear', timeZone)}`
        : filters.to !== undefined
          ? `Until ${formatDate(filters.to, 'dayMonthYear', timeZone)}`
          : 'All time';
  return filtered ? `${period}, matching your filters` : period;
}

/**
 * The live transaction ledger: record income, expenses, transfers, and balance corrections; find
 * any transaction with search and filters (kept in the URL); edit, void, and restore; act on many
 * at once. Every figure comes from the API, and nothing is saved in the browser.
 */
export function TransactionsPage(): ReactNode {
  const { user } = useSignedInSession();
  const timeZone = user.timezone;
  const { filters, setFilters, reconcileAccountId, wantsNew } = useTransactionFilters();

  const refs = useAsyncResource(loadReferenceData);
  const query = listQuery(filters);
  const totalsQuery = summaryQuery(filters);
  const showSummary = filters.status !== 'voided';
  const loadPage = useCallback(
    async (signal: AbortSignal): Promise<PageData> => {
      const [page, summary] = await Promise.all([
        listTransactions(query, signal),
        showSummary ? getTransactionSummary(totalsQuery, signal) : Promise.resolve(undefined),
      ]);
      return { query, page, summary };
    },
    [query, totalsQuery, showSummary],
  );
  const data = useAsyncResource(loadPage);

  const [entryMode, setEntryMode] = useState<EntrySheetMode | undefined>();
  const [details, setDetails] = useState<TransactionListItemDto | undefined>();
  const [voidTargets, setVoidTargets] = useState<TransactionListItemDto[] | undefined>();
  const [selection, setSelection] = useState<Set<string> | undefined>();
  const [bulkAction, setBulkAction] = useState<BulkEditAction | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [searchDraft, setSearchDraft] = useState<string | undefined>();

  // Another page can ask for the add form (`?new=1`) or a balance correction (`?reconcile=id`).
  const intentMode: EntrySheetMode | undefined =
    reconcileAccountId !== undefined
      ? { kind: 'reconcile', accountId: reconcileAccountId }
      : wantsNew
        ? { kind: 'create', type: 'expense' }
        : undefined;
  const sheetMode = entryMode ?? intentMode;

  const applyFilters = (next: TransactionFilters): void => {
    setSelection(undefined);
    setFilters(next);
  };

  // Search is applied a moment after typing stops, so every keystroke is not a request.
  const searchText = searchDraft ?? filters.q;
  useEffect(() => {
    if (searchDraft === undefined || searchDraft.trim() === filters.q) {
      return;
    }
    const timer = setTimeout(() => {
      setFilters(withFilters(filters, { q: searchDraft.trim() }));
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [searchDraft, filters, setFilters]);

  const refreshAll = (): void => {
    data.refresh();
    refs.refresh();
  };

  const closeEntry = (): void => {
    setEntryMode(undefined);
    if (intentMode !== undefined) {
      setFilters(filters); // Drops `new` / `reconcile` from the URL.
    }
  };

  const runAction = async (action: () => Promise<string>): Promise<void> => {
    setNotice(undefined);
    try {
      setNotice({ tone: 'success', message: await action() });
      refreshAll();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  const restore = (item: TransactionListItemDto): void => {
    setDetails(undefined);
    void runAction(async () => {
      await restoreTransaction(item.transaction.id);
      return `${counterpartyTitle(item)} was restored and counts again.`;
    });
  };

  const submitBulk = async (input: BulkTransactionInput): Promise<void> => {
    const result = await bulkUpdateTransactions(input);
    setBulkAction(undefined);
    setSelection(undefined);
    setNotice({
      tone: 'success',
      message: `${String(result.changed)} of ${String(result.requested)} transactions changed.`,
    });
    refreshAll();
  };

  const accounts = refs.state.status === 'success' ? refs.state.data.accounts : [];
  const categories = refs.state.status === 'success' ? refs.state.data.categories : [];
  const tagSuggestions = refs.state.status === 'success' ? refs.state.data.tags : [];
  const activeAccounts = accounts.filter((entry) => entry.account.status === 'active');
  const activeFilterCount = countActiveFilters(filters);
  const selectedIds = selection === undefined ? [] : [...selection];

  // --- Active filter chips ------------------------------------------------------------------------
  const chips: { key: string; label: string; clear: Partial<TransactionFilters> }[] = [];
  if (filters.type !== undefined) {
    chips.push({
      key: 'type',
      label: TRANSACTION_TYPE_PRESENTATION[filters.type].label,
      clear: { type: undefined },
    });
  }
  if (filters.accountId !== undefined) {
    const name = accounts.find((entry) => entry.account.id === filters.accountId)?.account.name;
    chips.push({ key: 'account', label: name ?? 'One account', clear: { accountId: undefined } });
  }
  if (filters.categoryId !== undefined) {
    const category = categories.find((entry) => entry.id === filters.categoryId);
    const parent = categories.find((entry) => entry.id === category?.parentId);
    chips.push({
      key: 'category',
      label:
        category === undefined
          ? 'One category'
          : categoryLabel({
              ...category,
              ...(parent === undefined ? {} : { parentName: parent.name }),
            }),
      clear: { categoryId: undefined },
    });
  }
  if (filters.paymentMethod !== undefined) {
    chips.push({
      key: 'method',
      label: PAYMENT_METHOD_LABELS[filters.paymentMethod],
      clear: { paymentMethod: undefined },
    });
  }
  for (const tag of filters.tags) {
    chips.push({
      key: `tag-${tag}`,
      label: `#${tag}`,
      clear: { tags: filters.tags.filter((entry) => entry !== tag) },
    });
  }
  if (filters.from !== undefined || filters.to !== undefined) {
    chips.push({
      key: 'dates',
      label: describeScope(
        { ...DEFAULT_FILTERS, from: filters.from, to: filters.to },
        timeZone,
        false,
      ),
      clear: { from: undefined, to: undefined },
    });
  }
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    const label =
      filters.minAmount !== undefined && filters.maxAmount !== undefined
        ? `${filters.minAmount} – ${filters.maxAmount}`
        : filters.minAmount !== undefined
          ? `At least ${filters.minAmount}`
          : `At most ${filters.maxAmount ?? ''}`;
    chips.push({ key: 'amount', label, clear: { minAmount: undefined, maxAmount: undefined } });
  }
  if (filters.status !== 'active') {
    chips.push({
      key: 'status',
      label: filters.status === 'voided' ? 'Voided only' : 'Including voided',
      clear: { status: 'active' },
    });
  }
  if (filters.q !== '') {
    chips.push({ key: 'q', label: `“${filters.q}”`, clear: { q: '' } });
  }

  const clearAll = (): void => {
    setSearchDraft(undefined);
    applyFilters({ ...DEFAULT_FILTERS, sort: filters.sort });
  };

  // --- Main content -------------------------------------------------------------------------------
  let content: ReactNode;
  if (data.state.status === 'loading') {
    content = <TransactionsSkeleton />;
  } else if (data.state.status === 'error') {
    content = (
      <ErrorState
        title="Your transactions could not be loaded"
        description={`${describeRequestError(data.state.error)} Nothing has been lost.`}
        onRetry={data.reload}
      />
    );
  } else if (data.state.data.page.items.length === 0) {
    const { totalItems } = data.state.data.page.pagination;
    if (totalItems > 0) {
      content = (
        <EmptyState
          icon={SearchX}
          title="This page is empty"
          description="The list changed since this page was opened."
        >
          <Button
            variant="outline"
            onClick={() => {
              applyFilters(withFilters(filters, { page: 1 }));
            }}
          >
            Back to the first page
          </Button>
        </EmptyState>
      );
    } else if (activeFilterCount > 0) {
      content = (
        <EmptyState
          icon={SearchX}
          title={
            filters.status === 'voided' && activeFilterCount === 1
              ? 'No voided transactions'
              : 'No transactions match'
          }
          description={
            filters.status === 'voided' && activeFilterCount === 1
              ? 'Transactions you void appear here, so you can restore them.'
              : 'Try another search term, or remove a filter.'
          }
        >
          <Button variant="outline" onClick={clearAll}>
            Clear search and filters
          </Button>
        </EmptyState>
      );
    } else if (refs.state.status === 'success' && activeAccounts.length === 0) {
      content = (
        <EmptyState
          icon={WalletCards}
          title="Add an account first"
          description="Transactions are recorded against an account: a bank account, a card, or cash. Add the one you use most, then come back."
        >
          <Button asChild size="lg" className="h-11">
            <Link href="/accounts">Go to accounts</Link>
          </Button>
        </EmptyState>
      );
    } else {
      content = (
        <EmptyState
          icon={ArrowLeftRight}
          title="Record your first transaction"
          description="Write down a payment, a salary, or a move between your accounts, with who it was for and why. You will be able to find it again in seconds."
        >
          <Button
            size="lg"
            className="h-11"
            onClick={() => {
              setEntryMode({ kind: 'create', type: 'expense' });
            }}
          >
            <Plus aria-hidden="true" />
            Add a transaction
          </Button>
        </EmptyState>
      );
    }
  } else {
    const { page, summary } = data.state.data;
    content = (
      <div className="flex flex-col gap-6">
        {summary !== undefined && (
          <TransactionSummary
            summary={summary}
            scope={describeScope(filters, timeZone, activeFilterCount > 0)}
          />
        )}
        <TransactionHistory
          items={page.items}
          pagination={page.pagination}
          timeZone={timeZone}
          selection={selection}
          onToggleSelected={(item) => {
            setSelection((current) => {
              const next = new Set(current);
              if (next.has(item.transaction.id)) {
                next.delete(item.transaction.id);
              } else {
                next.add(item.transaction.id);
              }
              return next;
            });
          }}
          onToggleAll={(items) => {
            setSelection((current) => {
              const all = items.every((item) => current?.has(item.transaction.id) === true);
              return new Set(all ? [] : items.map((item) => item.transaction.id));
            });
          }}
          onOpen={setDetails}
          onEdit={(item) => {
            setNotice(undefined);
            setEntryMode({ kind: 'edit', item });
          }}
          onVoid={(item) => {
            setVoidTargets([item]);
          }}
          onRestore={restore}
          onPage={(next) => {
            applyFilters(withFilters(filters, { page: next }));
          }}
        />
        {selection !== undefined && (
          <BulkActionBar
            count={selection.size}
            onAction={(action) => {
              if (action === 'void') {
                const items = page.items.filter((item) => selection.has(item.transaction.id));
                setVoidTargets(items);
              } else {
                setBulkAction(action);
              }
            }}
            onDone={() => {
              setSelection(undefined);
            }}
          />
        )}
      </div>
    );
  }

  const updating = data.state.status === 'success' && data.state.data.query !== query;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every payment and receipt, with who it was for and why."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setNotice(undefined);
                setEntryMode({ kind: 'reconcile' });
              }}
            >
              <Scale aria-hidden="true" />
              Correct a balance
            </Button>
            <Button
              onClick={() => {
                setNotice(undefined);
                setEntryMode({ kind: 'create', type: 'expense' });
              }}
            >
              <Plus aria-hidden="true" />
              Add transaction
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <SearchInput
            label="Search transactions"
            placeholder="Search merchant, purpose, or tag"
            value={searchText}
            onValueChange={setSearchDraft}
            className="xl:max-w-sm xl:flex-1"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              aria-label={
                activeFilterCount > 0 ? `Filters, ${String(activeFilterCount)} active` : 'Filters'
              }
              onClick={() => {
                setFiltersOpen(true);
              }}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums"
                >
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <NativeSelect
              aria-label="Sort transactions"
              className="h-11 w-auto sm:h-10"
              value={filters.sort}
              onChange={(event) => {
                const sort = SORT_OPTIONS.find(
                  (option) => option.value === event.target.value,
                )?.value;
                if (sort !== undefined) {
                  applyFilters(withFilters(filters, { sort }));
                }
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant={selection === undefined ? 'ghost' : 'secondary'}
              className="h-11 sm:h-10"
              aria-pressed={selection !== undefined}
              onClick={() => {
                setSelection((current) => (current === undefined ? new Set() : undefined));
              }}
            >
              <CheckSquare aria-hidden="true" />
              Select
            </Button>
            <Button
              variant="ghost"
              className="h-11 sm:h-10"
              onClick={() => {
                setCategoriesOpen(true);
              }}
            >
              <FolderTree aria-hidden="true" />
              Categories
            </Button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <ul aria-label="Active filters" className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip.key}>
                  <span className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border bg-accent pr-1 pl-3 text-sm text-accent-foreground">
                    <span className="truncate">{chip.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove filter ${chip.label}`}
                      onClick={() => {
                        if (chip.key === 'q') {
                          setSearchDraft(undefined);
                        }
                        applyFilters(withFilters(filters, chip.clear));
                      }}
                      className="grid size-6 place-items-center rounded-full hover:bg-background/70 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <Button variant="link" className="h-8 px-1" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
      {updating && (
        <p role="status" className="text-sm text-muted-foreground">
          Updating…
        </p>
      )}

      <div aria-busy={data.state.status === 'loading' || updating}>{content}</div>

      <TransactionEntrySheet
        mode={refs.state.status === 'success' ? sheetMode : undefined}
        accounts={accounts}
        categories={categories}
        tagSuggestions={tagSuggestions}
        timeZone={timeZone}
        defaultCurrency={user.preferredCurrency}
        onModeChange={setEntryMode}
        onClose={closeEntry}
        onSaved={(item, kind) => {
          closeEntry();
          setNotice({
            tone: 'success',
            message:
              kind === 'adjusted'
                ? `The balance of ${item.account.name} was corrected.`
                : kind === 'created'
                  ? `${counterpartyTitle(item)} was recorded.`
                  : `${counterpartyTitle(item)} was updated.`,
          });
          refreshAll();
        }}
      />

      <TransactionDetailsSheet
        item={details}
        timeZone={timeZone}
        onClose={() => {
          setDetails(undefined);
        }}
        onEdit={(item) => {
          setDetails(undefined);
          setNotice(undefined);
          setEntryMode({ kind: 'edit', item });
        }}
        onVoid={(item) => {
          setDetails(undefined);
          setVoidTargets([item]);
        }}
        onRestore={restore}
      />

      <VoidTransactionDialog
        count={voidTargets?.length}
        title={
          voidTargets?.length === 1 && voidTargets[0] !== undefined
            ? counterpartyTitle(voidTargets[0])
            : undefined
        }
        onCancel={() => {
          setVoidTargets(undefined);
        }}
        onConfirm={(reason) => {
          const targets = voidTargets ?? [];
          setVoidTargets(undefined);
          void runAction(async () => {
            if (targets.length === 1 && targets[0] !== undefined) {
              await voidTransaction(targets[0].transaction.id, reason);
              return `${counterpartyTitle(targets[0])} was voided. Find it under Voided to restore it.`;
            }
            const result = await bulkUpdateTransactions({
              action: 'void',
              transactionIds: targets.map((item) => item.transaction.id),
              ...(reason === undefined ? {} : { reason }),
            });
            setSelection(undefined);
            return `${String(result.changed)} transactions were voided.`;
          });
        }}
      />

      <BulkEditSheet
        action={bulkAction}
        transactionIds={selectedIds}
        categories={categories}
        tagSuggestions={tagSuggestions}
        describeError={describeRequestError}
        onSubmit={submitBulk}
        onClose={() => {
          setBulkAction(undefined);
        }}
      />

      <TransactionFiltersSheet
        open={filtersOpen}
        filters={filters}
        accounts={accounts.map((entry) => entry.account)}
        categories={categories}
        tagSuggestions={tagSuggestions}
        timeZone={timeZone}
        onClose={() => {
          setFiltersOpen(false);
        }}
        onApply={(next) => {
          setFiltersOpen(false);
          setSearchDraft(undefined);
          applyFilters(next);
        }}
      />

      <CategoryManagerSheet
        open={categoriesOpen}
        categories={categories}
        onChanged={refs.refresh}
        onClose={() => {
          setCategoriesOpen(false);
        }}
      />
    </>
  );
}
