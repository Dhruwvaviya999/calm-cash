import {
  calendarDateInTimeZone,
  TEXT_LIMITS,
  zonedDateTimeToInstant,
  type CurrencyCode,
  type ImportProposalDto,
  type ImportRowStatus,
  type ImportSettings,
  type StatementDirection,
} from '@calmcash/shared';

import { fromIsoDate } from '../../lib/calendar-dates';
import {
  detectDuplicates,
  type LedgerTransaction,
  type PriorImportedRow,
  type StagedRowFacts,
} from './duplicate-detection';
import { duplicatesOf, proposalOf, toTransactionRef } from './imports.mapper';
import type {
  LedgerRecord,
  PriorImportRecord,
  RowEvaluation,
  RowRecord,
  Suggestion,
} from './imports.repository';
import { descriptionKey, readRow, type RowReading } from './statement-reader';

// Turns staged rows into their evaluated state with the batch's confirmed settings: what each row
// says, what would be recorded for it, which rows might be duplicates, and its status. Pure: the
// service loads the inputs and writes the results.

const DEFAULT_TIME = '12:00';

function proposalTypeFits(type: ImportProposalDto['type'], direction: StatementDirection): boolean {
  return type === 'transfer' || (type === 'expense') === (direction === 'debit');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** What would be recorded for a readable row: an expense for money out, income for money in. */
export function proposeTransaction(
  reading: RowReading & { date: string; direction: StatementDirection },
  suggestion: Suggestion | undefined,
  timeZone: string,
): { proposal: ImportProposalDto; warnings: string[] } {
  const warnings: string[] = [];
  const source = reading.description !== '' ? reading.description : (reading.counterparty ?? '');
  const description = truncate(
    source === '' ? 'Imported from statement' : source,
    TEXT_LIMITS.transactionDescription,
  );
  if (source.length > TEXT_LIMITS.transactionDescription) {
    warnings.push('The description is longer than CalmCash keeps and was shortened.');
  }
  const counterparty =
    reading.counterparty === undefined
      ? undefined
      : truncate(reading.counterparty, TEXT_LIMITS.transactionMerchant);
  const merchant = counterparty ?? suggestion?.merchant ?? undefined;
  return {
    proposal: {
      type: reading.direction === 'debit' ? 'expense' : 'income',
      description,
      ...(merchant === undefined ? {} : { merchant }),
      ...(suggestion === undefined ? {} : { categoryId: suggestion.categoryId }),
      tags: [],
      occurredAt: zonedDateTimeToInstant(
        reading.date,
        reading.time ?? DEFAULT_TIME,
        timeZone,
      ).toISOString(),
      suggested: suggestion !== undefined,
    },
    warnings,
  };
}

export interface EvaluationInputs {
  accountId: string;
  currency: CurrencyCode;
  timeZone: string;
  settings: ImportSettings;
  rows: readonly RowRecord[];
  priorImports: readonly PriorImportRecord[];
  ledger: readonly LedgerRecord[];
  /** Transactions tied to rows of other imports. */
  linkedElsewhere: ReadonlySet<string>;
  suggestions: readonly Suggestion[];
  /** Keep the person's edits to proposals (the settings did not change). */
  keepProposals: boolean;
}

function toLedgerTransaction(record: LedgerRecord, timeZone: string): LedgerTransaction {
  return {
    id: record.id,
    type: record.type,
    accountId: record.accountId,
    transferAccountId: record.transferAccountId,
    adjustmentDirection: record.adjustmentDirection,
    amountMinor: record.amountMinor,
    currency: record.currency,
    localDate: calendarDateInTimeZone(record.occurredAt, timeZone),
    ref: toTransactionRef(record),
    key: descriptionKey(record.description, record.merchant ?? undefined),
  };
}

/** The evaluated state of every row that is not already matched or imported. */
export function evaluateRows(inputs: EvaluationInputs): RowEvaluation[] {
  const { settings, currency, timeZone } = inputs;
  const suggestionByKey = new Map(inputs.suggestions.map((entry) => [entry.descriptionKey, entry]));
  const open = inputs.rows.filter((row) => row.status !== 'matched' && row.status !== 'imported');
  const readings = new Map(open.map((row) => [row.id, readRow(row.cells, settings, currency)]));

  const facts: StagedRowFacts[] = open.flatMap((row) => {
    const reading = readings.get(row.id);
    if (
      reading === undefined ||
      reading.problems.length > 0 ||
      reading.date === undefined ||
      reading.amountMinor === undefined ||
      reading.direction === undefined ||
      row.status === 'skipped'
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        rowNumber: row.rowNumber,
        date: reading.date,
        amountMinor: reading.amountMinor,
        direction: reading.direction,
        reference: reading.reference,
        key: descriptionKey(reading.description, reading.counterparty),
      },
    ];
  });

  // Rows of this statement already tied to transactions are not offered to the others.
  const linked = new Set(inputs.linkedElsewhere);
  for (const row of inputs.rows) {
    if (row.matchedTransactionId !== null) linked.add(row.matchedTransactionId);
    if (row.importedTransactionId !== null) linked.add(row.importedTransactionId);
  }
  const duplicates = detectDuplicates({
    accountId: inputs.accountId,
    rows: facts,
    priorImports: inputs.priorImports.map((prior): PriorImportedRow => ({
      batchId: prior.batchId,
      fileName: prior.fileName,
      date: prior.occurredOn.toISOString().slice(0, 10),
      amountMinor: prior.amountMinor,
      direction: prior.direction,
      reference: prior.reference ?? undefined,
      key: prior.descriptionKey ?? '',
      transaction: toTransactionRef(prior.transaction),
    })),
    ledger: inputs.ledger.map((record) => toLedgerTransaction(record, timeZone)),
    linkedTransactionIds: linked,
  });

  return open.map((row): RowEvaluation => {
    const reading = readings.get(row.id) ?? readRow(row.cells, settings, currency);
    const key = descriptionKey(reading.description, reading.counterparty);
    const common = {
      id: row.id,
      occurredOn: reading.date === undefined ? null : fromIsoDate(reading.date),
      amountMinor: reading.amountMinor ?? null,
      direction: reading.direction ?? null,
      description: reading.description,
      reference: reading.reference ?? null,
      counterparty: reading.counterparty ?? null,
      descriptionKey: key === '' ? null : key,
      duplicateDismissed: row.duplicateDismissed,
    };
    if (
      reading.problems.length > 0 ||
      reading.date === undefined ||
      reading.amountMinor === undefined ||
      reading.direction === undefined
    ) {
      return {
        ...common,
        status: row.status === 'skipped' ? 'skipped' : 'invalid',
        problems: reading.problems,
        warnings: [],
        proposal: null,
        duplicates: [],
      };
    }
    const fresh = proposeTransaction(
      { ...reading, date: reading.date, direction: reading.direction },
      suggestionByKey.get(key),
      timeZone,
    );
    const existing = inputs.keepProposals ? proposalOf(row) : undefined;
    const proposal =
      existing !== undefined && proposalTypeFits(existing.type, reading.direction)
        ? existing
        : fresh.proposal;
    const found = row.status === 'skipped' ? duplicatesOf(row) : (duplicates.get(row.id) ?? []);
    let status: ImportRowStatus;
    if (row.status === 'skipped') {
      status = 'skipped';
    } else if (found.length > 0 && !row.duplicateDismissed) {
      status = 'review';
    } else {
      status = 'ready';
    }
    return {
      ...common,
      status,
      problems: [],
      warnings: fresh.warnings,
      proposal,
      duplicates: found,
    };
  });
}

/** The date range (with the match tolerance) that duplicate detection needs to load. */
export function evaluationWindow(
  rows: readonly RowRecord[],
  settings: ImportSettings,
  currency: CurrencyCode,
): { from: string; to: string } | undefined {
  const dates = rows
    .map((row) => readRow(row.cells, settings, currency).date)
    .filter((date) => date !== undefined)
    .sort();
  const [first] = dates;
  const last = dates.at(-1);
  return first === undefined || last === undefined ? undefined : { from: first, to: last };
}
