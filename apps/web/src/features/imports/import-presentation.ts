import type {
  AccountDto,
  AccountType,
  BalanceCheckDto,
  CategoryDto,
  CurrencyCode,
  DuplicateCandidateDto,
  ImportBatchDto,
  ImportBatchStatus,
  ImportRowDto,
  ImportRowStatus,
  MinorUnitsString,
} from '@calmcash/shared';

import type { StatusTone } from '@/components/feedback/status-badge';
import { formatDate, formatMoney } from '@/lib/format';

import { balancesAreOwed } from './import-settings-model';

// Words and tones for statement imports. No React here.

export const ROW_STATUS_PRESENTATION: Readonly<
  Record<ImportRowStatus, { label: string; tone: StatusTone }>
> = {
  invalid: { label: 'Cannot be read', tone: 'negative' },
  review: { label: 'Possible duplicate', tone: 'warning' },
  ready: { label: 'Ready', tone: 'upcoming' },
  matched: { label: 'Matched', tone: 'positive' },
  imported: { label: 'Imported', tone: 'positive' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Not imported', tone: 'negative' },
};

export const BATCH_STATUS_PRESENTATION: Readonly<
  Record<ImportBatchStatus, { label: string; tone: StatusTone }>
> = {
  mapping: { label: 'Columns to confirm', tone: 'warning' },
  reviewing: { label: 'In review', tone: 'upcoming' },
  completed: { label: 'Completed', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** The review list's filters; `attention` is invalid, possible duplicates, and failed rows. */
export const ROW_FILTERS = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'ready', label: 'Ready' },
  { value: 'imported', label: 'Imported' },
  { value: 'matched', label: 'Matched' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'all', label: 'All rows' },
] as const;

export type RowFilter = (typeof ROW_FILTERS)[number]['value'];

export function rowFilterCount(filter: RowFilter, batch: ImportBatchDto): number {
  const { counts } = batch;
  if (filter === 'attention') return counts.invalid + counts.review + counts.failed;
  if (filter === 'all') return batch.totalRows;
  return counts[filter];
}

/** Rows that an import request may record (failed rows are retried). */
export function isImportable(row: ImportRowDto): boolean {
  return row.status === 'ready' || row.status === 'failed';
}

/** Rows whose proposal the person may still change. */
export function isEditable(row: ImportRowDto): boolean {
  return row.status === 'ready' || row.status === 'review' || row.status === 'failed';
}

function days(count: number): string {
  if (count === 0) return 'on the same day';
  return `${String(count)} ${count === 1 ? 'day' : 'days'} apart`;
}

/** Why a row may already be recorded, in one sentence. */
export function describeDuplicate(candidate: DuplicateCandidateDto): string {
  switch (candidate.reason) {
    case 'same_reference':
      return `Line ${String(candidate.row?.rowNumber ?? '?')} of this statement has the same reference.`;
    case 'same_details':
      return `Line ${String(candidate.row?.rowNumber ?? '?')} of this statement has the same date, amount, and description.`;
    case 'previously_imported':
      return `Already imported from ${candidate.importedFrom?.fileName ?? 'an earlier statement'}.`;
    case 'existing_transaction':
      return `A transaction you recorded has the same amount, ${days(candidate.dateDifferenceDays ?? 0)}.`;
  }
}

/** A statement or ledger balance as people read it: cards and loans show the amount owed. */
export function describeBalance(
  minor: MinorUnitsString,
  currency: CurrencyCode,
  accountType: AccountType,
): string {
  if (!balancesAreOwed(accountType)) {
    return formatMoney(minor, currency);
  }
  const value = BigInt(minor);
  if (value === 0n) return `${formatMoney(0n, currency)} owed`;
  return value < 0n
    ? `${formatMoney(-value, currency)} owed`
    : `${formatMoney(value, currency)} in credit`;
}

const UNAVAILABLE_REASONS: Readonly<
  Record<Extract<BalanceCheckDto, { status: 'unavailable' }>['reason'], string>
> = {
  no_statement_balance: 'Enter this balance from the statement to compare it.',
  no_statement_date: 'Enter the statement dates to compare this balance.',
  before_tracking:
    'This date is before CalmCash starts tracking the account, so there is nothing to compare it with.',
  in_future: 'This date has not happened yet.',
};

export function describeUnavailable(
  check: Extract<BalanceCheckDto, { status: 'unavailable' }>,
): string {
  return UNAVAILABLE_REASONS[check.reason];
}

/** "1 Oct – 31 Oct 2026" for the statement, or the dates of its rows when no period was given. */
export function describePeriod(batch: ImportBatchDto): string | undefined {
  const from = batch.statement.periodStart ?? batch.rowDates?.from;
  const to = batch.statement.periodEnd ?? batch.rowDates?.to;
  if (from === undefined || to === undefined) {
    return undefined;
  }
  return from === to
    ? formatDate(from, 'dayMonthYear')
    : `${formatDate(from, 'dayMonthYear')} – ${formatDate(to, 'dayMonthYear')}`;
}

/** "12 imported, 3 matched, 1 skipped" — only the outcomes that happened. */
export function describeOutcomes(batch: ImportBatchDto): string {
  const { counts } = batch;
  const parts = [
    counts.imported > 0 ? `${String(counts.imported)} imported` : undefined,
    counts.matched > 0 ? `${String(counts.matched)} matched` : undefined,
    counts.skipped > 0 ? `${String(counts.skipped)} skipped` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? 'Nothing imported yet' : parts.join(', ');
}

/** "Food › Restaurants" for a subcategory; `undefined` when the category is not known here. */
export function categoryName(
  categories: readonly CategoryDto[],
  categoryId: string | undefined,
): string | undefined {
  const category = categories.find((entry) => entry.id === categoryId);
  if (category === undefined) return undefined;
  const parent = categories.find((entry) => entry.id === category.parentId);
  return parent === undefined ? category.name : `${parent.name} › ${category.name}`;
}

/** What importing the row will record, in a few words ("Expense · Groceries"). */
export function describeProposal(
  row: ImportRowDto,
  categories: readonly CategoryDto[],
  accounts: readonly AccountDto[],
): string {
  if (row.status === 'matched') return 'Nothing new (linked to your transaction)';
  if (row.status === 'skipped') return 'Nothing (skipped)';
  const { proposal } = row;
  if (proposal === undefined) {
    return row.status === 'invalid' ? 'Nothing (cannot be read)' : 'Nothing to record';
  }
  if (proposal.type === 'transfer') {
    const other = accounts.find((account) => account.id === proposal.transferAccountId)?.name;
    const direction = row.direction === 'credit' ? 'from' : 'to';
    return other === undefined
      ? `Transfer ${direction} (choose the account)`
      : `Transfer ${direction} ${other}`;
  }
  const kind = proposal.type === 'expense' ? 'Expense' : 'Income';
  const category = categoryName(categories, proposal.categoryId);
  if (category === undefined) return `${kind} · choose a category`;
  return `${kind} · ${category}${proposal.suggested ? ' (suggested)' : ''}`;
}

/** The most useful single line about a row's state, if anything needs saying. */
export function rowNote(row: ImportRowDto): string | undefined {
  switch (row.status) {
    case 'invalid':
      return row.problems[0]?.message;
    case 'failed':
      return row.error;
    case 'review': {
      const [first] = row.duplicates;
      return first === undefined ? undefined : describeDuplicate(first);
    }
    case 'ready':
    case 'matched':
    case 'imported':
    case 'skipped':
      return row.warnings[0];
  }
}

/** How the statement differs from the ledger (statement − ledger), from the person's side. */
export function describeDifference(
  differenceMinor: MinorUnitsString,
  currency: CurrencyCode,
  accountType: AccountType,
): string {
  const value = BigInt(differenceMinor);
  if (value === 0n) return 'They match.';
  const amount = formatMoney(value < 0n ? -value : value, currency);
  if (balancesAreOwed(accountType)) {
    return value < 0n
      ? `The statement shows ${amount} more owed than your ledger.`
      : `The statement shows ${amount} less owed than your ledger.`;
  }
  return value > 0n
    ? `The statement shows ${amount} more than your ledger.`
    : `The statement shows ${amount} less than your ledger.`;
}
