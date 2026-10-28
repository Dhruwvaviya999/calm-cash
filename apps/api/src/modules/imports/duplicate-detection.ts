import {
  daysBetween,
  MATCH_DATE_TOLERANCE_DAYS,
  MAX_MATCH_CANDIDATES,
  type DuplicateCandidateDto,
  type ImportTransactionRefDto,
  type IsoDateString,
  type StatementDirection,
  type TransactionType,
} from '@calmcash/shared';

// Duplicate detection, in three independent checks (see docs/database-design.md §3e):
//
// 1. Within the statement: rows with the same bank reference (strong evidence), otherwise rows with
//    the same date, amount, direction, and normalised description (two genuine identical payments
//    are possible, so these are flagged for review, never dropped).
// 2. Earlier imports into the same account: a row with the same reference, or the same date,
//    amount, direction, and description, that was already imported or matched.
// 3. The ledger: an active transaction on the account with the same amount, currency, and money
//    direction, dated within ±3 days, that no statement row is linked to yet. Amount alone is never
//    enough: the date window always applies, and candidates are ranked by date distance, then by
//    how many description words they share.
//
// Every finding is a suggestion the person reviews. Pure functions: no database, no clock.

export interface StagedRowFacts {
  id: string;
  rowNumber: number;
  date: IsoDateString;
  amountMinor: bigint;
  direction: StatementDirection;
  reference?: string | undefined;
  key: string;
}

export interface LedgerTransaction {
  id: string;
  type: TransactionType;
  accountId: string;
  transferAccountId: string | null;
  adjustmentDirection: 'increase' | 'decrease' | null;
  amountMinor: bigint;
  currency: string;
  /** Calendar date of `occurredAt` in the user's time zone. */
  localDate: IsoDateString;
  ref: ImportTransactionRefDto;
  /** Normalised description and merchant. */
  key: string;
}

export interface PriorImportedRow {
  batchId: string;
  fileName: string;
  date: IsoDateString;
  amountMinor: bigint;
  direction: StatementDirection;
  reference?: string | undefined;
  key: string;
  transaction: ImportTransactionRefDto;
}

/** Whether a transaction moves money in the given direction for the account. */
export function movesMoney(
  transaction: Pick<
    LedgerTransaction,
    'type' | 'accountId' | 'transferAccountId' | 'adjustmentDirection'
  >,
  accountId: string,
  direction: StatementDirection,
): boolean {
  switch (transaction.type) {
    case 'expense':
      return direction === 'debit' && transaction.accountId === accountId;
    case 'income':
      return direction === 'credit' && transaction.accountId === accountId;
    case 'transfer':
      return direction === 'debit'
        ? transaction.accountId === accountId
        : transaction.transferAccountId === accountId;
    case 'balance_adjustment':
      return (
        transaction.accountId === accountId &&
        (direction === 'debit'
          ? transaction.adjustmentDirection === 'decrease'
          : transaction.adjustmentDirection === 'increase')
      );
  }
}

function normaliseReference(reference: string | undefined): string | undefined {
  const value = reference?.replace(/\s+/g, '').toUpperCase();
  return value === undefined || value === '' ? undefined : value;
}

function sharedWords(a: string, b: string): number {
  const words = new Set(a.split(' ').filter((word) => word.length > 2));
  return b.split(' ').filter((word) => word.length > 2 && words.has(word)).length;
}

function sameDetails(a: StagedRowFacts, b: Omit<StagedRowFacts, 'id' | 'rowNumber'>): boolean {
  return (
    a.date === b.date &&
    a.amountMinor === b.amountMinor &&
    a.direction === b.direction &&
    a.key !== '' &&
    a.key === b.key
  );
}

export interface DuplicateInputs {
  accountId: string;
  rows: readonly StagedRowFacts[];
  priorImports: readonly PriorImportedRow[];
  ledger: readonly LedgerTransaction[];
  /** Transactions already linked to a statement row (they are not offered again). */
  linkedTransactionIds: ReadonlySet<string>;
}

/** Possible duplicates per row ID (rows without any are absent). */
export function detectDuplicates({
  accountId,
  rows,
  priorImports,
  ledger,
  linkedTransactionIds,
}: DuplicateInputs): Map<string, DuplicateCandidateDto[]> {
  const found = new Map<string, DuplicateCandidateDto[]>();
  const add = (rowId: string, candidate: DuplicateCandidateDto): void => {
    found.set(rowId, [...(found.get(rowId) ?? []), candidate]);
  };

  // 1. Within the statement.
  const byReference = new Map<string, StagedRowFacts[]>();
  for (const row of rows) {
    const reference = normaliseReference(row.reference);
    if (reference !== undefined) {
      byReference.set(reference, [...(byReference.get(reference) ?? []), row]);
    }
  }
  for (const row of rows) {
    const reference = normaliseReference(row.reference);
    const sameReference = reference === undefined ? [] : (byReference.get(reference) ?? []);
    const other =
      sameReference.find((entry) => entry.id !== row.id) ??
      rows.find(
        (entry) =>
          entry.id !== row.id &&
          sameDetails(row, entry) &&
          (reference === undefined || normaliseReference(entry.reference) === undefined),
      );
    if (other !== undefined) {
      add(row.id, {
        reason: sameReference.some((entry) => entry.id === other.id)
          ? 'same_reference'
          : 'same_details',
        row: { id: other.id, rowNumber: other.rowNumber },
      });
    }
  }

  // 2. Earlier imports into the same account.
  const fromPriorImports = new Map<string, Set<string>>();
  for (const row of rows) {
    const reference = normaliseReference(row.reference);
    const prior = priorImports.find((entry) => {
      const priorReference = normaliseReference(entry.reference);
      return reference !== undefined && priorReference !== undefined
        ? reference === priorReference
        : sameDetails(row, entry);
    });
    if (prior !== undefined) {
      add(row.id, {
        reason: 'previously_imported',
        transaction: prior.transaction,
        importedFrom: { batchId: prior.batchId, fileName: prior.fileName },
        dateDifferenceDays: Math.abs(daysBetween(row.date, prior.date)),
      });
      fromPriorImports.set(row.id, new Set([prior.transaction.id]));
    }
  }

  // 3. The ledger.
  for (const row of rows) {
    const skip = fromPriorImports.get(row.id) ?? new Set<string>();
    const candidates = ledger
      .filter(
        (transaction) =>
          !linkedTransactionIds.has(transaction.id) &&
          !skip.has(transaction.id) &&
          transaction.amountMinor === row.amountMinor &&
          movesMoney(transaction, accountId, row.direction) &&
          Math.abs(daysBetween(row.date, transaction.localDate)) <= MATCH_DATE_TOLERANCE_DAYS,
      )
      .map((transaction) => ({
        transaction,
        distance: Math.abs(daysBetween(row.date, transaction.localDate)),
        words: sharedWords(row.key, transaction.key),
      }))
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          b.words - a.words ||
          a.transaction.id.localeCompare(b.transaction.id),
      )
      .slice(0, MAX_MATCH_CANDIDATES);
    for (const { transaction, distance } of candidates) {
      add(row.id, {
        reason: 'existing_transaction',
        transaction: transaction.ref,
        dateDifferenceDays: distance,
      });
    }
  }
  return found;
}
