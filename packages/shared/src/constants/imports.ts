// Statement-import and receipt rules shared by the API (enforcement) and the web app (forms,
// guidance). Limits are deliberately small: statements and receipts are personal documents, not
// bulk data feeds.

// --- Statement import ----------------------------------------------------------------------------

/** Supported statement formats. OFX/QFX are a documented future enhancement. */
export const IMPORT_FORMATS = ['csv'] as const;

export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** Largest statement file accepted (bytes). */
export const MAX_STATEMENT_FILE_BYTES = 2 * 1024 * 1024;
/** Most data rows one statement may contain. */
export const MAX_STATEMENT_ROWS = 5000;
/** Most columns one statement may contain. */
export const MAX_STATEMENT_COLUMNS = 40;
/** Longest cell accepted (characters); a longer cell makes the file unreadable (refused). */
export const MAX_STATEMENT_CELL_LENGTH = 500;
/** Longest original file name kept. */
export const MAX_IMPORT_FILE_NAME_LENGTH = 120;

/** Field separators the parser understands. */
export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Date layouts a statement may use. Day-first and month-first layouts are both offered; when the
 * sample values fit more than one, the person must choose — a date is never guessed.
 */
export const IMPORT_DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'DD.MM.YYYY',
  'DD/MM/YY',
  'MM/DD/YY',
  'DD-MMM-YYYY',
  'DD MMM YYYY',
  'DD-MMM-YY',
] as const;

export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

/** `.` for 1,234.56 (thousands with commas or spaces); `,` for 1.234,56. */
export const DECIMAL_SEPARATORS = ['.', ','] as const;

export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number];

/**
 * How one signed amount column reads. There is no default: whether a positive number is money in
 * or money out differs between banks, so the person states it.
 */
export const SIGN_CONVENTIONS = ['negative_is_debit', 'negative_is_credit'] as const;

export type SignConvention = (typeof SIGN_CONVENTIONS)[number];

/** Money out of the account (`debit`) or into it (`credit`), from the account's point of view. */
export const STATEMENT_DIRECTIONS = ['debit', 'credit'] as const;

export type StatementDirection = (typeof STATEMENT_DIRECTIONS)[number];

/**
 * `mapping`: uploaded, columns not confirmed yet. `reviewing`: rows staged for review and import.
 * `completed` and `cancelled` are final; imported transactions always stay in the ledger.
 */
export const IMPORT_BATCH_STATUSES = ['mapping', 'reviewing', 'completed', 'cancelled'] as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/**
 * What happens to one staged row:
 * - `invalid`: it could not be read with the current settings (never imported);
 * - `review`: readable, but possibly a duplicate — the person decides;
 * - `ready`: may be imported once it is classified;
 * - `matched`: linked to an existing transaction (no new money movement);
 * - `imported`: a new transaction was recorded from it;
 * - `skipped`: the person left it out;
 * - `failed`: an import attempt was refused (kept for correction and retry).
 */
export const IMPORT_ROW_STATUSES = [
  'invalid',
  'review',
  'ready',
  'matched',
  'imported',
  'skipped',
  'failed',
] as const;

export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/** Why a row was flagged as a possible duplicate. */
export const DUPLICATE_REASONS = [
  'same_reference',
  'same_details',
  'previously_imported',
  'existing_transaction',
] as const;

export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

/** Days either side of the statement date within which an existing transaction may match. */
export const MATCH_DATE_TOLERANCE_DAYS = 3;
/** Candidate transactions shown per row. */
export const MAX_MATCH_CANDIDATES = 3;
/** Rows one import request may process (bounded; larger statements import in several requests). */
export const MAX_IMPORT_ROWS_PER_REQUEST = 200;
/** Rows per page of the review list. */
export const IMPORT_ROWS_PAGE_SIZE = 100;
/** Rows shown as they appear in the file while columns are mapped. */
export const IMPORT_SAMPLE_ROWS = 5;
/** Statement batches listed in the import history. */
export const MAX_IMPORT_BATCHES_LISTED = 50;

// --- Receipts --------------------------------------------------------------------------------------

/** Receipt types, identified by their content (file signature), never by name or declared type. */
export const RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

/** File-name extensions accepted for each receipt type. */
export const RECEIPT_EXTENSIONS: Readonly<Record<ReceiptContentType, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

/** Largest receipt accepted (bytes). */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
/** Most receipts one transaction may carry. */
export const MAX_RECEIPTS_PER_TRANSACTION = 10;
/** Longest original receipt file name kept. */
export const MAX_RECEIPT_FILE_NAME_LENGTH = 120;
