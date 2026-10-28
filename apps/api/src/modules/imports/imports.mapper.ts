import {
  csvDelimiterSchema,
  currencyCodeSchema,
  duplicateCandidateDtoSchema,
  IMPORT_ROW_STATUSES,
  importProblemDtoSchema,
  importProposalDtoSchema,
  importSettingsSchema,
  serializeMinorUnits,
  type ImportBatchDto,
  type ImportProposalDto,
  type ImportRowCounts,
  type ImportRowDto,
  type ImportRowStatus,
  type ImportSettings,
  type ImportTransactionRefDto,
} from '@calmcash/shared';
import { z } from 'zod';

import { toIsoDate } from '../../lib/calendar-dates';
import { toAccountRef } from './account-ref';
import type { BatchWithAccount, LedgerRecord, RowRecord } from './imports.repository';

// Database rows → public DTOs. JSON columns are validated with the shared schemas on every read,
// so a malformed stored value fails loudly instead of reaching a client. Raw cells and the file's
// physical location never leave the API.

const problemsSchema = z.array(importProblemDtoSchema);
const warningsSchema = z.array(z.string());
const duplicatesSchema = z.array(duplicateCandidateDtoSchema);

export function settingsOf(batch: Pick<BatchWithAccount, 'settings'>): ImportSettings | undefined {
  return batch.settings === null ? undefined : importSettingsSchema.parse(batch.settings);
}

export function proposalOf(row: Pick<RowRecord, 'proposal'>): ImportProposalDto | undefined {
  return row.proposal === null ? undefined : importProposalDtoSchema.parse(row.proposal);
}

export function duplicatesOf(row: Pick<RowRecord, 'duplicates'>): ImportRowDto['duplicates'] {
  return duplicatesSchema.parse(row.duplicates);
}

export function toTransactionRef(transaction: LedgerRecord): ImportTransactionRefDto {
  return {
    id: transaction.id,
    type: transaction.type,
    amountMinor: serializeMinorUnits(transaction.amountMinor),
    currency: currencyCodeSchema.parse(transaction.currency),
    occurredAt: transaction.occurredAt.toISOString(),
    description: transaction.description,
    ...(transaction.merchant === null ? {} : { merchant: transaction.merchant }),
    status: transaction.voidedAt === null ? 'active' : 'voided',
  };
}

export function emptyCounts(): ImportRowCounts {
  return { invalid: 0, review: 0, ready: 0, matched: 0, imported: 0, skipped: 0, failed: 0 };
}

export function toBatchDto(
  batch: BatchWithAccount,
  counts: ReadonlyMap<ImportRowStatus, number> | undefined,
  dates: { from: Date; to: Date } | undefined,
): ImportBatchDto {
  const rowCounts = emptyCounts();
  for (const status of IMPORT_ROW_STATUSES) {
    rowCounts[status] = counts?.get(status) ?? 0;
  }
  const settings = settingsOf(batch);
  return {
    id: batch.id,
    userId: batch.userId,
    account: toAccountRef(batch.account),
    fileName: batch.fileName,
    format: 'csv',
    delimiter: csvDelimiterSchema.parse(batch.delimiter),
    hasHeaderRow: batch.hasHeaderRow,
    currency: currencyCodeSchema.parse(batch.currency),
    status: batch.status,
    columns: [...batch.columns],
    ...(settings === undefined ? {} : { settings }),
    statement: {
      ...(batch.periodStart === null ? {} : { periodStart: toIsoDate(batch.periodStart) }),
      ...(batch.periodEnd === null ? {} : { periodEnd: toIsoDate(batch.periodEnd) }),
      ...(batch.openingBalanceMinor === null
        ? {}
        : { openingBalanceMinor: serializeMinorUnits(batch.openingBalanceMinor) }),
      ...(batch.closingBalanceMinor === null
        ? {}
        : { closingBalanceMinor: serializeMinorUnits(batch.closingBalanceMinor) }),
    },
    ...(dates === undefined
      ? {}
      : { rowDates: { from: toIsoDate(dates.from), to: toIsoDate(dates.to) } }),
    totalRows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0),
    counts: rowCounts,
    ...(batch.reconciledAt === null
      ? {}
      : {
          reconciliation: {
            checkedAt: batch.reconciledAt.toISOString(),
            ...(batch.reconciliationDifferenceMinor === null
              ? {}
              : { differenceMinor: serializeMinorUnits(batch.reconciliationDifferenceMinor) }),
            ...(batch.adjustmentTransactionId === null
              ? {}
              : { adjustmentTransactionId: batch.adjustmentTransactionId }),
          },
        }),
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    ...(batch.completedAt === null ? {} : { completedAt: batch.completedAt.toISOString() }),
    ...(batch.cancelledAt === null ? {} : { cancelledAt: batch.cancelledAt.toISOString() }),
  };
}

export function toRowDto(row: RowRecord): ImportRowDto {
  const proposal = proposalOf(row);
  const base = {
    id: row.id,
    batchId: row.batchId,
    rowNumber: row.rowNumber,
    ...(row.occurredOn === null ? {} : { date: toIsoDate(row.occurredOn) }),
    ...(row.amountMinor === null ? {} : { amountMinor: serializeMinorUnits(row.amountMinor) }),
    ...(row.direction === null ? {} : { direction: row.direction }),
    description: row.description,
    ...(row.reference === null ? {} : { reference: row.reference }),
    ...(row.counterparty === null ? {} : { counterparty: row.counterparty }),
    ...(proposal === undefined ? {} : { proposal }),
    warnings: warningsSchema.parse(row.warnings),
    duplicates: duplicatesOf(row),
    duplicateDismissed: row.duplicateDismissed,
  };
  switch (row.status) {
    case 'invalid': {
      const problems = problemsSchema.parse(row.problems);
      return {
        ...base,
        status: 'invalid',
        problems:
          problems.length > 0 ? problems : [{ field: 'row', message: 'This row cannot be read.' }],
      };
    }
    case 'matched':
      if (row.matchedTransactionId === null) throw new Error('Matched row without a transaction.');
      return { ...base, status: 'matched', transactionId: row.matchedTransactionId };
    case 'imported':
      if (row.importedTransactionId === null)
        throw new Error('Imported row without a transaction.');
      return { ...base, status: 'imported', transactionId: row.importedTransactionId };
    case 'failed':
      return { ...base, status: 'failed', error: row.error ?? 'The import failed.' };
    case 'review':
    case 'ready':
    case 'skipped':
      return { ...base, status: row.status };
  }
}
