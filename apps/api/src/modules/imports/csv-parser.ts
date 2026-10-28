import {
  CSV_DELIMITERS,
  MAX_STATEMENT_CELL_LENGTH,
  MAX_STATEMENT_COLUMNS,
  MAX_STATEMENT_ROWS,
  type CsvDelimiter,
} from '@calmcash/shared';

// A small, strict CSV reader (RFC 4180 plus the variants banks produce): UTF-8 with or without a
// byte-order mark, CRLF, LF, or CR line endings, quoted fields containing separators, quotes ("")
// and line breaks. It works on text that has already been size-limited by the HTTP layer and
// stops as soon as a resource limit is exceeded, so a hostile file cannot make it work harder than
// a legitimate one. It never evaluates cell contents.

export type CsvFailure =
  | 'not_text'
  | 'spreadsheet'
  | 'pdf'
  | 'empty'
  | 'unterminated_quote'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'cell_too_long'
  | 'single_column';

export class CsvParseError extends Error {
  override readonly name = 'CsvParseError';
  constructor(
    readonly reason: CsvFailure,
    message: string,
  ) {
    super(message);
  }
}

const FAILURE_MESSAGES: Readonly<Record<CsvFailure, string>> = {
  not_text: 'This file is not a text CSV file. Export the statement as CSV and try again.',
  spreadsheet:
    'This looks like a spreadsheet (Excel) file. Open it and save it as CSV, then upload the CSV.',
  pdf: 'This is a PDF. CalmCash imports CSV statements; download the CSV version from your bank.',
  empty: 'The file has no rows.',
  unterminated_quote: 'A quoted value is never closed, so the file cannot be read reliably.',
  too_many_rows: `The statement has more than ${MAX_STATEMENT_ROWS} rows. Split it into smaller periods.`,
  too_many_columns: `A row has more than ${MAX_STATEMENT_COLUMNS} columns.`,
  cell_too_long: `A value is longer than ${MAX_STATEMENT_CELL_LENGTH} characters.`,
  single_column:
    'Only one column was found. Choose the separator this file uses (comma, semicolon, tab, or |).',
};

function fail(reason: CsvFailure): never {
  throw new CsvParseError(reason, FAILURE_MESSAGES[reason]);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Decodes the bytes as strict UTF-8 (the byte-order mark is dropped). Spreadsheets, PDFs, and
 * other binary content are refused whatever the file is called.
 */
export function decodeCsvText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    fail('spreadsheet');
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    fail('pdf');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    fail('not_text');
  }
  // NUL and other C0 controls (apart from tab and line breaks) do not occur in text statements.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      fail('not_text');
    }
  }
  return text;
}

/** Reads all records with one separator. Empty lines are dropped; cells are not trimmed. */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let cellStarted = false;
  let index = 0;

  const pushCell = (): void => {
    if (cell.length > MAX_STATEMENT_CELL_LENGTH) fail('cell_too_long');
    record.push(cell);
    if (record.length > MAX_STATEMENT_COLUMNS) fail('too_many_columns');
    cell = '';
    cellStarted = false;
  };
  const pushRecord = (): void => {
    pushCell();
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record);
      if (records.length > MAX_STATEMENT_ROWS + 1) fail('too_many_rows');
    }
    record = [];
  };

  while (index < text.length) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      if (cell.length > MAX_STATEMENT_CELL_LENGTH) fail('cell_too_long');
      index += 1;
      continue;
    }
    if (char === '"' && !cellStarted && cell.trim() === '') {
      // A quote opens a field only at its start (leading spaces before it are dropped).
      cell = '';
      quoted = true;
      cellStarted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      pushRecord();
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += char;
    if (char !== ' ') cellStarted = cellStarted || cell.trim() !== '';
    if (cell.length > MAX_STATEMENT_CELL_LENGTH) fail('cell_too_long');
    index += 1;
  }
  if (quoted) fail('unterminated_quote');
  if (cell !== '' || record.length > 0) pushRecord();
  if (records.length === 0) fail('empty');
  return records;
}

/**
 * The separator that splits the first lines into the same number (more than one) of columns.
 * `undefined` when none does, so the person chooses.
 */
export function detectDelimiter(text: string): CsvDelimiter | undefined {
  const sample = text.slice(0, 20_000);
  let best: { delimiter: CsvDelimiter; columns: number } | undefined;
  for (const delimiter of CSV_DELIMITERS) {
    let records: string[][];
    try {
      records = parseCsv(sample, delimiter).slice(0, 20);
    } catch {
      continue;
    }
    // The sample may cut the last record; ignore it.
    const lines = records.length > 1 ? records.slice(0, -1) : records;
    const widths = new Set(lines.map((line) => line.length));
    const [width = 1] = widths;
    if (widths.size === 1 && width > 1 && (best === undefined || width > best.columns)) {
      best = { delimiter, columns: width };
    }
  }
  return best?.delimiter;
}

/** Full statement read: decode, split, and check there is more than one column. */
export function readStatement(
  bytes: Uint8Array,
  requested: CsvDelimiter | undefined,
): { delimiter: CsvDelimiter; records: string[][] } {
  const text = decodeCsvText(bytes);
  if (text.trim() === '') fail('empty');
  const delimiter = requested ?? detectDelimiter(text) ?? ',';
  const records = parseCsv(text, delimiter);
  if (records.every((record) => record.length < 2)) fail('single_column');
  return { delimiter, records };
}
