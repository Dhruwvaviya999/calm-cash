import type { CurrencyCode } from '../constants/currencies';
import type { PaymentMethod, TransactionType } from '../constants/domain';
import type {
  CsvDelimiter,
  DecimalSeparator,
  DuplicateReason,
  ImportBatchStatus,
  ImportDateFormat,
  ImportFormat,
  ImportRowStatus,
  SignConvention,
  StatementDirection,
} from '../constants/imports';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';
import type { PaginationDto, TransactionAccountRefDto } from './transaction';

// --- Settings ------------------------------------------------------------------------------------

/**
 * How money is read. Either one signed column whose sign convention the person states, or
 * separate debit and credit columns. Column numbers are zero-based positions in the file.
 */
export type ImportAmountMapping =
  | { mode: 'signed'; column: number; convention: SignConvention }
  | { mode: 'split'; debitColumn: number; creditColumn: number };

export interface ImportColumnMapping {
  date: number;
  description: number;
  amount: ImportAmountMapping;
  /** Payee, payer, or merchant, when the statement has such a column. */
  counterparty?: number;
  /** The bank's own reference (UTR, transaction ID, cheque number). */
  reference?: number;
}

export interface ImportSettings {
  dateFormat: ImportDateFormat;
  decimalSeparator: DecimalSeparator;
  mapping: ImportColumnMapping;
}

/** What the person (or the file) says about the statement as a whole. Never invented. */
export interface StatementInfo {
  periodStart?: IsoDateString;
  periodEnd?: IsoDateString;
  /** Signed net position at the start of `periodStart` (owed amounts are negative). */
  openingBalanceMinor?: MinorUnitsString;
  /** Signed net position at the end of `periodEnd`. */
  closingBalanceMinor?: MinorUnitsString;
}

/** Columns proposed from the header names and sample values (absent when nothing fits). */
export interface ProposedImportMapping {
  date?: number;
  description?: number;
  counterparty?: number;
  reference?: number;
  /** A signed amount column; its sign convention is never proposed. */
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
}

/** Mapping proposed from the header names and sample values; the person confirms or changes it. */
export interface ProposedImportSettings {
  mapping: ProposedImportMapping;
  /** Every date layout that fits all sample dates; more than one means the person must choose. */
  dateFormats: ImportDateFormat[];
  decimalSeparator?: DecimalSeparator;
}

// --- Batches -------------------------------------------------------------------------------------

export type ImportRowCounts = Record<ImportRowStatus, number>;

export interface ImportReconciliationRecordDto {
  checkedAt: IsoDateTimeString;
  /** Statement closing balance − ledger balance at the statement's end, when it was checked. */
  differenceMinor?: MinorUnitsString;
  /** The balance adjustment the person approved, if any. */
  adjustmentTransactionId?: EntityId;
}

export interface ImportBatchDto {
  id: EntityId;
  userId: EntityId;
  account: TransactionAccountRefDto;
  fileName: string;
  format: ImportFormat;
  delimiter: CsvDelimiter;
  hasHeaderRow: boolean;
  currency: CurrencyCode;
  status: ImportBatchStatus;
  /** Header names, or "Column 1", "Column 2", … without a header row. */
  columns: string[];
  settings?: ImportSettings;
  statement: StatementInfo;
  /** Dates of the readable rows (absent until rows are read). */
  rowDates?: { from: IsoDateString; to: IsoDateString };
  totalRows: number;
  counts: ImportRowCounts;
  reconciliation?: ImportReconciliationRecordDto;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  completedAt?: IsoDateTimeString;
  cancelledAt?: IsoDateTimeString;
}

export interface ImportBatchDetailDto extends ImportBatchDto {
  /** The first rows as they appear in the file (only while the batch is open). */
  sampleRows: string[][];
  proposed: ProposedImportSettings;
}

export interface ImportBatchListDto {
  batches: ImportBatchDto[];
}

// --- Rows ----------------------------------------------------------------------------------------

/** A problem with one row, in plain words. `field` names the statement field concerned. */
export interface ImportProblemDto {
  field: 'date' | 'amount' | 'description' | 'reference' | 'counterparty' | 'row';
  message: string;
}

/** An existing transaction, as shown next to a possible duplicate. */
export interface ImportTransactionRefDto {
  id: EntityId;
  type: TransactionType;
  amountMinor: MinorUnitsString;
  currency: CurrencyCode;
  occurredAt: IsoDateTimeString;
  description: string;
  merchant?: string;
  status: 'active' | 'voided';
}

/** Why a row might already be recorded, and what it might be the same as. */
export interface DuplicateCandidateDto {
  reason: DuplicateReason;
  /** Another row of the same statement (`same_reference`, `same_details`). */
  row?: { id: EntityId; rowNumber: number };
  /** An existing transaction (`previously_imported`, `existing_transaction`). */
  transaction?: ImportTransactionRefDto;
  /** The earlier statement it came from (`previously_imported`). */
  importedFrom?: { batchId: EntityId; fileName: string };
  /** Calendar days between the statement date and the candidate's date. */
  dateDifferenceDays?: number;
}

/** What will be recorded for a row; the person can change every field here. */
export interface ImportProposalDto {
  type: 'expense' | 'income' | 'transfer';
  /** Transfers only: the other account (destination of a debit, source of a credit). */
  transferAccountId?: EntityId;
  description: string;
  merchant?: string;
  categoryId?: EntityId;
  paymentMethod?: PaymentMethod;
  notes?: string;
  tags: string[];
  occurredAt: IsoDateTimeString;
  /** True when the category or merchant was suggested from earlier transactions. */
  suggested: boolean;
}

export interface ImportRowBase {
  id: EntityId;
  batchId: EntityId;
  /** Line of the data row in the file (the header row is line 1 when present). */
  rowNumber: number;
  date?: IsoDateString;
  amountMinor?: MinorUnitsString;
  direction?: StatementDirection;
  /** The bank's own description, exactly as read (bounded). */
  description: string;
  reference?: string;
  counterparty?: string;
  proposal?: ImportProposalDto;
  /** Readable rows with something worth knowing (e.g. a time-less date). */
  warnings: string[];
  /** Possible duplicates found when the row was last checked (kept after a decision). */
  duplicates: DuplicateCandidateDto[];
  /** The person said it is not a duplicate. */
  duplicateDismissed: boolean;
}

/** A row that cannot be read with the current settings; it is never imported. */
export interface InvalidImportRowDto extends ImportRowBase {
  status: 'invalid';
  problems: ImportProblemDto[];
}

/** Possibly a duplicate: the person decides before it can be imported. */
export interface ReviewImportRowDto extends ImportRowBase {
  status: 'review';
}

export interface ReadyImportRowDto extends ImportRowBase {
  status: 'ready';
}

/** Linked to a transaction that was already recorded; nothing new is recorded. */
export interface MatchedImportRowDto extends ImportRowBase {
  status: 'matched';
  transactionId: EntityId;
}

export interface ImportedImportRowDto extends ImportRowBase {
  status: 'imported';
  transactionId: EntityId;
}

export interface SkippedImportRowDto extends ImportRowBase {
  status: 'skipped';
}

/** Its import was refused; nothing was recorded, and it can be corrected and retried. */
export interface FailedImportRowDto extends ImportRowBase {
  status: 'failed';
  error: string;
}

export type ImportRowDto =
  | InvalidImportRowDto
  | ReviewImportRowDto
  | ReadyImportRowDto
  | MatchedImportRowDto
  | ImportedImportRowDto
  | SkippedImportRowDto
  | FailedImportRowDto;

export interface ImportRowPageDto {
  items: ImportRowDto[];
  pagination: PaginationDto;
}

// --- Results -------------------------------------------------------------------------------------

export type ImportRowOutcome = 'imported' | 'already_imported' | 'failed' | 'not_ready';

export interface ImportRowResultDto {
  rowId: EntityId;
  rowNumber: number;
  outcome: ImportRowOutcome;
  transactionId?: EntityId;
  message?: string;
}

/** Exactly what one import request did; partial success is reported as such. */
export interface ImportRowsResultDto {
  requested: number;
  imported: number;
  alreadyImported: number;
  failed: number;
  notReady: number;
  results: ImportRowResultDto[];
  batch: ImportBatchDto;
}

/** A comparison of a statement balance with the ledger at the same instant. */
export type BalanceCheckDto =
  | {
      status: 'available';
      /** The instant compared: the end of `periodEnd` (or the start of `periodStart`). */
      asOf: IsoDateTimeString;
      statementBalanceMinor: MinorUnitsString;
      ledgerBalanceMinor: MinorUnitsString;
      /** Statement − ledger; zero when they agree. */
      differenceMinor: MinorUnitsString;
    }
  | {
      status: 'unavailable';
      reason: 'no_statement_balance' | 'no_statement_date' | 'before_tracking' | 'in_future';
    };

export interface ImportReconciliationDto {
  batch: ImportBatchDto;
  opening: BalanceCheckDto;
  closing: BalanceCheckDto;
  /** Rows still staged (review, ready, failed): resolving them may explain a difference. */
  unresolvedRows: number;
}

// --- Requests ------------------------------------------------------------------------------------

/** Query of the upload request; the file itself is the raw request body. */
export interface ImportUploadQuery {
  accountId: EntityId;
  fileName: string;
  /** Detected from the file when omitted. */
  delimiter?: CsvDelimiter;
  /** Detected from the first row when omitted. */
  hasHeaderRow?: boolean;
}

export interface ImportSettingsInput {
  settings: ImportSettings;
  statement?: StatementInfo;
}

export interface UpdateImportRowInput {
  type?: ImportProposalDto['type'];
  transferAccountId?: EntityId | null;
  description?: string;
  merchant?: string | null;
  categoryId?: EntityId | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string | null;
  tags?: string[];
  occurredAt?: IsoDateTimeString;
}

export type ImportRowDecisionInput =
  | { action: 'match'; transactionId: EntityId }
  | { action: 'not_duplicate' }
  | { action: 'skip' }
  | { action: 'restore' };

export interface ClassifyImportRowsInput {
  rowIds: EntityId[];
  categoryId: EntityId;
}

export interface ImportRowsInput {
  rowIds: EntityId[];
}

export interface ImportRowListQuery {
  /** `attention`: invalid, review, and failed rows. */
  status?: ImportRowStatus | 'attention' | 'open';
  page: number;
}

export interface ImportAdjustmentInput {
  /** The signed change the person reviewed; refused when the balance moved meanwhile. */
  expectedAdjustmentMinor: MinorUnitsString;
  description: string;
}
