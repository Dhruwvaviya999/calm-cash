'use client';

import {
  IMPORT_ROWS_PAGE_SIZE,
  MAX_IMPORT_ROWS_PER_REQUEST,
  type AccountDto,
  type ImportBatchDetailDto,
  type ImportRowDto,
  type ImportRowPageDto,
  type ImportRowResultDto,
} from '@calmcash/shared';
import { ArrowRight, FileCheck2, RefreshCw, SearchX } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { FilterOptions } from '@/components/forms/filter-bar';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { CategorySelect } from '@/features/transactions';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import {
  classifyImportRows,
  importRows,
  listImportRows,
  recheckImport,
} from '@/services/imports.service';

import {
  describeProposal,
  isImportable,
  ROW_FILTERS,
  ROW_STATUS_PRESENTATION,
  rowFilterCount,
  rowNote,
  type RowFilter,
} from '../import-presentation';
import { ImportRowSheet } from './import-row-sheet';
import type { ImportReferences } from './import-wizard';

export interface ReviewStepProps {
  batch: ImportBatchDetailDto;
  references: ImportReferences;
  timeZone: string;
  /** Finished imports: rows are shown, nothing can change. */
  readOnly: boolean;
  onBatchChanged: () => void;
  onContinue: () => void;
}

type Notice =
  | { tone: 'success' | 'error' | 'info'; message: string; failures?: ImportRowResultDto[] }
  | undefined;

interface Totals {
  imported: number;
  alreadyImported: number;
  failed: number;
  notReady: number;
  failures: ImportRowResultDto[];
}

const NO_TOTALS: Totals = { imported: 0, alreadyImported: 0, failed: 0, notReady: 0, failures: [] };

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Exactly what happened, partial success included. */
function describeTotals(totals: Totals): Notice {
  const parts: string[] = [];
  if (totals.imported > 0)
    parts.push(`${plural(totals.imported, 'row was', 'rows were')} imported.`);
  if (totals.alreadyImported > 0) {
    parts.push(
      `${plural(totals.alreadyImported, 'row was', 'rows were')} already imported and not recorded again.`,
    );
  }
  if (totals.notReady > 0) {
    parts.push(
      `${plural(totals.notReady, 'row needs', 'rows need')} a category, an account, or a decision first.`,
    );
  }
  if (totals.failed > 0) {
    parts.push(
      `${plural(totals.failed, 'row was', 'rows were')} refused; nothing was recorded for ${totals.failed === 1 ? 'it' : 'them'}.`,
    );
  }
  if (parts.length === 0) {
    return { tone: 'info', message: 'There was nothing to import.' };
  }
  return {
    tone: totals.failed > 0 ? 'error' : totals.notReady > 0 ? 'info' : 'success',
    message: parts.join(' '),
    failures: totals.failures,
  };
}

function defaultFilter(batch: ImportBatchDetailDto): RowFilter {
  if (rowFilterCount('attention', batch) > 0) return 'attention';
  if (batch.counts.ready > 0) return 'ready';
  return 'all';
}

/**
 * Every row of the statement: what it will become, possible duplicates to decide on, rows that
 * cannot be read. Approved rows are imported here, in bounded requests that never record a row
 * twice; the result says exactly what happened to each one.
 */
export function ReviewStep({
  batch,
  references,
  timeZone,
  readOnly,
  onBatchChanged,
  onContinue,
}: ReviewStepProps): ReactNode {
  const [filter, setFilter] = useState<RowFilter>(() => defaultFilter(batch));
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [openRow, setOpenRow] = useState<ImportRowDto | undefined>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState<'import' | 'classify' | 'recheck' | undefined>();
  const [bulkCategory, setBulkCategory] = useState('');

  const query = `${filter === 'all' ? '' : `status=${filter}&`}page=${String(page)}`;
  const rows = useAsyncResource(
    useCallback(
      async (signal: AbortSignal): Promise<{ query: string; page: ImportRowPageDto }> => ({
        query,
        page: await listImportRows(batch.id, query, signal),
      }),
      [batch.id, query],
    ),
  );

  const accounts: AccountDto[] = references.accounts.map((entry) => entry.account);
  const items = rows.state.status === 'success' ? rows.state.data.page.items : [];
  const importable = items.filter(isImportable);
  const selected = [...selection].filter((id) => items.some((row) => row.id === id));
  const selectedRows = items.filter((row) => selection.has(row.id));
  const selectedKinds = new Set(
    selectedRows.flatMap((row) =>
      row.proposal === undefined || row.proposal.type === 'transfer' ? [] : [row.proposal.type],
    ),
  );
  const [selectedKind] = [...selectedKinds];

  const changed = (): void => {
    setSelection(new Set());
    rows.refresh();
    onBatchChanged();
  };

  const run = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<Notice>,
  ): Promise<void> => {
    setBusy(kind);
    setNotice(undefined);
    try {
      setNotice(await action());
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    } finally {
      setBusy(undefined);
      changed();
    }
  };

  const importSelected = (): Promise<void> =>
    run('import', async () => {
      const result = await importRows(batch.id, selected);
      return describeTotals({
        imported: result.imported,
        alreadyImported: result.alreadyImported,
        failed: result.failed,
        notReady: result.notReady,
        failures: result.results.filter((entry) => entry.outcome === 'failed'),
      });
    });

  // Ready rows go in bounded requests. Rows still missing a category stay "ready" and keep their
  // place, so each round starts after the ones already tried.
  const importAllReady = (): Promise<void> =>
    run('import', async () => {
      const totals: Totals = { ...NO_TOTALS, failures: [] };
      const tried = new Set<string>();
      let stuck = 0;
      for (
        let round = 0;
        round <= Math.ceil(batch.totalRows / IMPORT_ROWS_PAGE_SIZE) + 1;
        round += 1
      ) {
        const next = await listImportRows(
          batch.id,
          `status=ready&page=${String(Math.floor(stuck / IMPORT_ROWS_PAGE_SIZE) + 1)}`,
        );
        const ids = next.items
          .map((row) => row.id)
          .filter((id) => !tried.has(id))
          .slice(0, MAX_IMPORT_ROWS_PER_REQUEST);
        if (ids.length === 0) break;
        for (const id of ids) tried.add(id);
        const result = await importRows(batch.id, ids);
        totals.imported += result.imported;
        totals.alreadyImported += result.alreadyImported;
        totals.failed += result.failed;
        totals.notReady += result.notReady;
        totals.failures.push(...result.results.filter((entry) => entry.outcome === 'failed'));
        stuck += result.notReady;
      }
      return describeTotals(totals);
    });

  const classify = (): Promise<void> =>
    run('classify', async () => {
      await classifyImportRows(batch.id, selected, bulkCategory);
      setBulkCategory('');
      return {
        tone: 'success',
        message: `The category was set on ${plural(selected.length, 'row', 'rows')}.`,
      };
    });

  const recheck = (): Promise<void> =>
    run('recheck', async () => {
      await recheckImport(batch.id);
      return {
        tone: 'success',
        message: 'Rows were checked again against your transactions and earlier imports.',
      };
    });

  const toggle = (row: ImportRowDto): void => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };
  const allSelected = importable.length > 0 && importable.every((row) => selection.has(row.id));
  const toggleAll = (): void => {
    setSelection(allSelected ? new Set() : new Set(importable.map((row) => row.id)));
  };

  let content: ReactNode;
  if (rows.state.status === 'loading') {
    content = (
      <div role="status" aria-live="polite" className="rounded-2xl border bg-card px-4 py-2">
        <span className="sr-only">Loading rows…</span>
        <ListSkeleton rows={5} />
      </div>
    );
  } else if (rows.state.status === 'error') {
    content = (
      <ErrorState
        title="The rows could not be loaded"
        description={describeRequestError(rows.state.error)}
        onRetry={rows.reload}
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={filter === 'attention' ? FileCheck2 : SearchX}
        title={filter === 'attention' ? 'Nothing needs your attention' : 'No rows here'}
        description={
          filter === 'attention'
            ? 'Every row can be read, and no possible duplicate is waiting for a decision.'
            : 'Choose another filter to see the other rows.'
        }
        headingLevel="h3"
      />
    );
  } else {
    const { pagination } = rows.state.data.page;
    content = (
      <RowList
        items={items}
        currency={batch.currency}
        categories={references.categories}
        accounts={accounts}
        selection={readOnly ? undefined : selection}
        allSelected={allSelected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onOpen={setOpenRow}
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        onPage={(next) => {
          setSelection(new Set());
          setPage(next);
        }}
      />
    );
  }

  const updating = rows.state.status === 'success' && rows.state.data.query !== query;

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(['attention', 'ready', 'imported', 'matched', 'skipped'] as const).map((key) => (
          <div key={key} className="rounded-xl border bg-card px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">
              {ROW_FILTERS.find((entry) => entry.value === key)?.label}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{rowFilterCount(key, batch)}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterOptions
          legend="Show rows"
          name="import-row-filter"
          options={ROW_FILTERS.map((entry) => ({
            value: entry.value,
            label: `${entry.label} (${String(rowFilterCount(entry.value, batch))})`,
          }))}
          value={filter}
          onValueChange={(next) => {
            setSelection(new Set());
            setPage(1);
            setFilter(next);
          }}
        />
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              disabled={busy !== undefined}
              onClick={() => void recheck()}
            >
              <RefreshCw aria-hidden="true" />
              {busy === 'recheck' ? 'Checking…' : 'Check duplicates again'}
            </Button>
            <Button
              className="h-11 sm:h-10"
              disabled={busy !== undefined || batch.counts.ready === 0}
              aria-busy={busy === 'import'}
              onClick={() => void importAllReady()}
            >
              {busy === 'import'
                ? 'Importing…'
                : `Import all ready (${String(batch.counts.ready)})`}
            </Button>
          </div>
        )}
      </div>

      {!readOnly && selected.length > 0 && (
        <div
          role="region"
          aria-label="Selected rows"
          className="flex flex-col gap-3 rounded-2xl border bg-accent/40 p-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <p className="text-sm font-medium sm:mr-auto sm:self-center">
            {plural(selected.length, 'row', 'rows')} selected
          </p>
          {selectedKinds.size === 1 && selectedKind !== undefined && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <CategorySelect
                aria-label="Category for the selected rows"
                categories={references.categories}
                kind={selectedKind}
                placeholder="Choose a category"
                value={bulkCategory}
                onChange={(event) => {
                  setBulkCategory(event.target.value);
                }}
                className="sm:w-56"
              />
              <Button
                variant="outline"
                className="h-11"
                disabled={bulkCategory === '' || busy !== undefined}
                onClick={() => void classify()}
              >
                Set category
              </Button>
            </div>
          )}
          <Button
            className="h-11"
            disabled={busy !== undefined}
            onClick={() => void importSelected()}
          >
            Import selected
          </Button>
        </div>
      )}

      {notice !== undefined && (
        <FormMessage tone={notice.tone}>
          {notice.message}
          {notice.failures !== undefined && notice.failures.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {notice.failures.slice(0, 5).map((failure) => (
                <li key={failure.rowId}>
                  Line {failure.rowNumber}: {failure.message ?? 'Not recorded.'}
                </li>
              ))}
              {notice.failures.length > 5 && (
                <li>…and {notice.failures.length - 5} more, listed under Needs attention.</li>
              )}
            </ul>
          )}
        </FormMessage>
      )}
      {updating && (
        <p role="status" className="text-sm text-muted-foreground">
          Updating…
        </p>
      )}

      <div aria-busy={rows.state.status === 'loading' || updating}>{content}</div>

      {!readOnly && (
        <div className="flex flex-col gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Done with the rows? Compare the statement with your ledger.
          </p>
          <Button variant="outline" size="lg" className="h-11" onClick={onContinue}>
            Continue to reconcile
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      )}

      <ImportRowSheet
        batch={batch}
        row={openRow}
        references={references}
        timeZone={timeZone}
        readOnly={readOnly}
        onClose={() => {
          setOpenRow(undefined);
        }}
        onChanged={(row) => {
          setOpenRow(row);
          changed();
        }}
      />
    </div>
  );
}

interface RowListProps {
  items: ImportRowDto[];
  currency: ImportBatchDetailDto['currency'];
  categories: ImportReferences['categories'];
  accounts: AccountDto[];
  selection: ReadonlySet<string> | undefined;
  allSelected: boolean;
  onToggle: (row: ImportRowDto) => void;
  onToggleAll: () => void;
  onOpen: (row: ImportRowDto) => void;
  page: number;
  totalPages: number;
  totalItems: number;
  onPage: (page: number) => void;
}

function RowAmount({
  row,
  currency,
}: {
  row: ImportRowDto;
  currency: RowListProps['currency'];
}): ReactNode {
  if (row.amountMinor === undefined || row.direction === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <FinancialAmount
      amountMinor={row.amountMinor}
      currency={currency}
      direction={row.direction === 'credit' ? 'credit' : 'debit'}
      size="sm"
    />
  );
}

function RowDate({ row }: { row: ImportRowDto }): ReactNode {
  return row.date === undefined ? (
    <span className="text-muted-foreground">No date</span>
  ) : (
    <time dateTime={row.date}>{formatDate(row.date, 'dayMonthYear')}</time>
  );
}

function SelectBox({
  row,
  selected,
  onToggle,
}: {
  row: ImportRowDto;
  selected: boolean;
  onToggle: () => void;
}): ReactNode {
  if (!isImportable(row)) {
    return <span aria-hidden="true" className="inline-block size-4" />;
  }
  return (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      aria-label={`Select line ${String(row.rowNumber)}`}
      className="relative z-10 size-4 cursor-pointer accent-primary"
    />
  );
}

function RowList({
  items,
  currency,
  categories,
  accounts,
  selection,
  allSelected,
  onToggle,
  onToggleAll,
  onOpen,
  page,
  totalPages,
  totalItems,
  onPage,
}: RowListProps): ReactNode {
  const first = (page - 1) * IMPORT_ROWS_PAGE_SIZE + 1;
  const last = first + items.length - 1;
  return (
    <div className="flex flex-col gap-4">
      {/* Phones, tablets, and narrow laptops */}
      <ul
        aria-label="Statement rows"
        className="divide-y rounded-2xl border bg-card shadow-sm xl:hidden"
      >
        {items.map((row) => {
          const status = ROW_STATUS_PRESENTATION[row.status];
          const note = rowNote(row);
          return (
            <li key={row.id} className="relative flex items-start gap-3 px-4 py-3.5">
              {selection !== undefined && (
                <div className="pt-1">
                  <SelectBox
                    row={row}
                    selected={selection.has(row.id)}
                    onToggle={() => {
                      onToggle(row);
                    }}
                  />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-medium break-words">
                    {row.description || 'No description'}
                  </p>
                  <RowAmount row={row} currency={currency} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Line {row.rowNumber} · <RowDate row={row} />
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {describeProposal(row, categories, accounts)}
                  </span>
                </div>
                {note !== undefined && (
                  <p
                    className={cn(
                      'text-xs',
                      row.status === 'invalid' || row.status === 'failed'
                        ? 'text-expense'
                        : 'text-muted-foreground',
                    )}
                  >
                    {note}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label={`Review line ${String(row.rowNumber)}`}
                onClick={() => {
                  onOpen(row);
                }}
                className="absolute inset-0 rounded-2xl outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              />
            </li>
          );
        })}
      </ul>

      {/* Wide desktops */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm xl:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">
            Statement rows {first}–{last} of {totalItems}
          </caption>
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {selection !== undefined && (
                <th scope="col" className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    aria-label="Select all importable rows on this page"
                    className="size-4 cursor-pointer accent-primary"
                  />
                </th>
              )}
              <th scope="col" className="w-16 px-3 py-3 font-medium">
                Line
              </th>
              <th scope="col" className="w-32 px-3 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Description
              </th>
              <th scope="col" className="w-64 px-3 py-3 font-medium">
                Will be recorded as
              </th>
              <th scope="col" className="w-40 px-3 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="w-36 px-3 py-3 text-right font-medium">
                Amount
              </th>
              <th scope="col" className="w-24 px-3 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((row) => {
              const status = ROW_STATUS_PRESENTATION[row.status];
              const note = rowNote(row);
              return (
                <tr key={row.id} className="align-top hover:bg-muted/30">
                  {selection !== undefined && (
                    <td className="px-4 py-3.5">
                      <SelectBox
                        row={row}
                        selected={selection.has(row.id)}
                        onToggle={() => {
                          onToggle(row);
                        }}
                      />
                    </td>
                  )}
                  <td className="px-3 py-3.5 tabular-nums">{row.rowNumber}</td>
                  <td className="px-3 py-3.5 whitespace-nowrap tabular-nums">
                    <RowDate row={row} />
                  </td>
                  <td className="px-3 py-3.5">
                    <p className="font-medium break-words">{row.description || 'No description'}</p>
                    {(row.counterparty !== undefined || row.reference !== undefined) && (
                      <p className="text-xs break-words text-muted-foreground">
                        {[
                          row.counterparty,
                          row.reference === undefined ? undefined : `Ref ${row.reference}`,
                        ]
                          .filter((part) => part !== undefined)
                          .join(' · ')}
                      </p>
                    )}
                    {note !== undefined && (
                      <p
                        className={cn(
                          'mt-1 text-xs',
                          row.status === 'invalid' || row.status === 'failed'
                            ? 'text-expense'
                            : 'text-muted-foreground',
                        )}
                      >
                        {note}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-muted-foreground">
                    {describeProposal(row, categories, accounts)}
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    <RowAmount row={row} currency={currency} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Review line ${String(row.rowNumber)}`}
                      onClick={() => {
                        onOpen(row);
                      }}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav aria-label="Row pages" className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            disabled={page <= 1}
            onClick={() => {
              onPage(page - 1);
            }}
          >
            Previous
          </Button>
          <p className="text-sm text-muted-foreground tabular-nums">
            {first}–{last} of {totalItems}
          </p>
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            disabled={page >= totalPages}
            onClick={() => {
              onPage(page + 1);
            }}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
