import {
  IMPORT_DATE_FORMATS,
  MAX_ENTERED_AMOUNT_MINOR,
  parseDecimalAmount,
  describeDecimalAmountError,
  type CurrencyCode,
  type DecimalSeparator,
  type ImportDateFormat,
  type ImportProblemDto,
  type ImportSettings,
  type IsoDateString,
  type ProposedImportSettings,
  type StatementDirection,
} from '@calmcash/shared';

// Reads statement cells with explicit settings: dates in a stated layout, amounts with a stated
// sign convention or separate debit and credit columns. Nothing is guessed: a value that does not
// fit the settings makes the row invalid with a plain explanation. Pure functions, no clock.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): IsoDateString | undefined {
  if (
    year < 1900 ||
    year > 2999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysIn(year, month)
  ) {
    return undefined;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Two-digit years: 00–69 are 2000–2069, 70–99 are 1970–1999. */
function fullYear(text: string): number {
  const value = Number(text);
  return text.length === 4 ? value : value < 70 ? 2000 + value : 1900 + value;
}

const PATTERNS: Readonly<
  Record<ImportDateFormat, { regex: RegExp; order: 'ymd' | 'dmy' | 'mdy' }>
> = {
  'YYYY-MM-DD': { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: 'ymd' },
  'YYYY/MM/DD': { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: 'ymd' },
  'DD/MM/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'dmy' },
  'MM/DD/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'mdy' },
  'DD-MM-YYYY': { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'dmy' },
  'MM-DD-YYYY': { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'mdy' },
  'DD.MM.YYYY': { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: 'dmy' },
  'DD/MM/YY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: 'dmy' },
  'MM/DD/YY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: 'mdy' },
  'DD-MMM-YYYY': { regex: /^(\d{1,2})-([a-z]{3})-(\d{4})$/i, order: 'dmy' },
  'DD MMM YYYY': { regex: /^(\d{1,2}) ([a-z]{3}) (\d{4})$/i, order: 'dmy' },
  'DD-MMM-YY': { regex: /^(\d{1,2})-([a-z]{3})-(\d{2})$/i, order: 'dmy' },
};

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export interface ParsedDate {
  date: IsoDateString;
  /** `HH:mm` when the cell carried a time. */
  time?: string;
}

/** A date (optionally followed by a time) in exactly the given layout. */
export function parseStatementDate(
  value: string,
  format: ImportDateFormat,
): ParsedDate | undefined {
  const [datePart = '', timePart, ...rest] = value
    .trim()
    .replace(/\s+/g, ' ')
    .split(/(?<=\d{2,4}) (?=\d{1,2}:)/);
  if (rest.length > 0) return undefined;
  const { regex, order } = PATTERNS[format];
  const match = regex.exec(datePart);
  if (match === null) return undefined;
  const [, a = '', b = '', c = ''] = match;
  const month = (text: string): number => {
    const index = MONTHS.indexOf(text.toLowerCase());
    return index >= 0 ? index + 1 : Number(text);
  };
  const date =
    order === 'ymd'
      ? iso(Number(a), Number(b), Number(c))
      : order === 'dmy'
        ? iso(fullYear(c), month(b), Number(a))
        : iso(fullYear(c), Number(a), Number(b));
  if (date === undefined) return undefined;
  if (timePart === undefined) return { date };
  const time = TIME.exec(timePart);
  if (time === null) return undefined;
  const hours = Number(time[1]);
  const minutes = Number(time[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return { date, time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
}

/**
 * The layouts that read the most of the given values (all of them in a clean file). A few bad
 * dates do not hide the right layout; several layouts tying means the person must choose.
 */
export function likelyDateFormats(values: readonly string[]): ImportDateFormat[] {
  const present = values.map((value) => value.trim()).filter((value) => value !== '');
  const scores = IMPORT_DATE_FORMATS.map((format) => ({
    format,
    count: present.filter((value) => parseStatementDate(value, format) !== undefined).length,
  }));
  const best = Math.max(0, ...scores.map((score) => score.count));
  return best === 0
    ? []
    : scores.filter((score) => score.count === best).map((score) => score.format);
}

/** Every layout that reads all the given (non-empty) values. */
export function matchingDateFormats(values: readonly string[]): ImportDateFormat[] {
  const present = values.map((value) => value.trim()).filter((value) => value !== '');
  if (present.length === 0) return [];
  return IMPORT_DATE_FORMATS.filter((format) =>
    present.every((value) => parseStatementDate(value, format) !== undefined),
  );
}

export interface ParsedAmount {
  minorUnits: bigint;
  negative: boolean;
  /** An explicit "Cr" or "Dr" written next to the number. */
  marker?: StatementDirection;
}

export type AmountReading =
  | { status: 'blank' }
  | { status: 'ok'; amount: ParsedAmount }
  | { status: 'error'; message: string };

const CURRENCY_TEXT =
  /^(?:[₹$€£¥]|rs\.?|inr|usd|eur|gbp|aed|sgd|jpy|kwd)\s*|\s*(?:[₹$€£¥]|inr|usd|eur|gbp|aed|sgd|jpy|kwd)$/i;

/**
 * An amount cell in the account's currency: grouping separators, a leading or trailing minus,
 * parentheses for negatives, a currency symbol, and a trailing "Cr"/"Dr" are understood. The
 * precision is checked against the currency, never rounded.
 */
export function parseStatementAmount(
  value: string,
  decimalSeparator: DecimalSeparator,
  currency: CurrencyCode,
): AmountReading {
  let text = value.trim();
  if (text === '' || text === '-') return { status: 'blank' };
  let marker: StatementDirection | undefined;
  const markerMatch = /\s*\b(cr|dr)\.?$/i.exec(text);
  if (markerMatch !== null) {
    marker = markerMatch[1]?.toLowerCase() === 'cr' ? 'credit' : 'debit';
    text = text.slice(0, markerMatch.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  // A currency symbol or code may sit on either side of the sign.
  text = text.replace(CURRENCY_TEXT, '').replace(CURRENCY_TEXT, '').trim();
  if (text.startsWith('-') || text.endsWith('-')) {
    negative = true;
    text = text.replace(/^-+|-+$/g, '').trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }
  text = text.replace(CURRENCY_TEXT, '').trim();
  // \s already covers no-break and narrow no-break spaces used as digit-group separators.
  const groups = decimalSeparator === '.' ? /[,\s']/g : /[.\s']/g;
  const normalised =
    decimalSeparator === '.'
      ? text.replace(groups, '')
      : text.replace(groups, '').replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalised)) {
    return { status: 'error', message: `“${value.trim().slice(0, 40)}” is not an amount.` };
  }
  const parsed = parseDecimalAmount(normalised, currency);
  if (!parsed.ok) {
    return { status: 'error', message: describeDecimalAmountError(parsed.error, currency) };
  }
  if (parsed.minorUnits > MAX_ENTERED_AMOUNT_MINOR) {
    return { status: 'error', message: 'This amount is too large.' };
  }
  return {
    status: 'ok',
    amount: {
      minorUnits: parsed.minorUnits,
      negative,
      ...(marker === undefined ? {} : { marker }),
    },
  };
}

export interface RowReading {
  date?: IsoDateString;
  time?: string;
  amountMinor?: bigint;
  direction?: StatementDirection;
  description: string;
  reference?: string;
  counterparty?: string;
  problems: ImportProblemDto[];
}

function cell(cells: readonly string[], column: number | undefined): string {
  return column === undefined ? '' : (cells[column] ?? '').trim();
}

/** One data row read with confirmed settings. Problems are collected, never thrown. */
export function readRow(
  cells: readonly string[],
  settings: ImportSettings,
  currency: CurrencyCode,
): RowReading {
  const { mapping } = settings;
  const problems: ImportProblemDto[] = [];
  const description = cell(cells, mapping.description).replace(/\s+/g, ' ');
  const reference = cell(cells, mapping.reference);
  const counterparty = cell(cells, mapping.counterparty).replace(/\s+/g, ' ');

  const rawDate = cell(cells, mapping.date);
  const parsedDate = rawDate === '' ? undefined : parseStatementDate(rawDate, settings.dateFormat);
  if (rawDate === '') {
    problems.push({ field: 'date', message: 'The date is missing.' });
  } else if (parsedDate === undefined) {
    problems.push({
      field: 'date',
      message: `“${rawDate.slice(0, 40)}” is not a valid date in the ${settings.dateFormat} format.`,
    });
  }

  let amountMinor: bigint | undefined;
  let direction: StatementDirection | undefined;
  if (mapping.amount.mode === 'signed') {
    const reading = parseStatementAmount(
      cell(cells, mapping.amount.column),
      settings.decimalSeparator,
      currency,
    );
    if (reading.status === 'blank') {
      problems.push({ field: 'amount', message: 'The amount is missing.' });
    } else if (reading.status === 'error') {
      problems.push({ field: 'amount', message: reading.message });
    } else if (reading.amount.minorUnits === 0n) {
      problems.push({ field: 'amount', message: 'The amount is zero, so nothing moved.' });
    } else if (reading.amount.marker !== undefined && reading.amount.negative) {
      problems.push({
        field: 'amount',
        message: 'The amount has both a minus sign and Cr/Dr, so its direction is unclear.',
      });
    } else {
      amountMinor = reading.amount.minorUnits;
      const negativeIsDebit = mapping.amount.convention === 'negative_is_debit';
      direction =
        reading.amount.marker ?? (reading.amount.negative === negativeIsDebit ? 'debit' : 'credit');
    }
  } else {
    const debit = parseStatementAmount(
      cell(cells, mapping.amount.debitColumn),
      settings.decimalSeparator,
      currency,
    );
    const credit = parseStatementAmount(
      cell(cells, mapping.amount.creditColumn),
      settings.decimalSeparator,
      currency,
    );
    const present = (reading: AmountReading): reading is { status: 'ok'; amount: ParsedAmount } =>
      reading.status === 'ok' && reading.amount.minorUnits > 0n;
    if (debit.status === 'error')
      problems.push({ field: 'amount', message: `Debit: ${debit.message}` });
    if (credit.status === 'error')
      problems.push({ field: 'amount', message: `Credit: ${credit.message}` });
    if (debit.status !== 'error' && credit.status !== 'error') {
      if (present(debit) && present(credit)) {
        problems.push({
          field: 'amount',
          message:
            'Both the debit and the credit column have an amount, so the direction is unclear.',
        });
      } else if (!present(debit) && !present(credit)) {
        problems.push({
          field: 'amount',
          message: 'Neither the debit nor the credit column has an amount.',
        });
      } else {
        const chosen = present(debit) ? debit : credit;
        if (present(chosen) && (chosen.amount.negative || chosen.amount.marker !== undefined)) {
          problems.push({
            field: 'amount',
            message: 'A sign or Cr/Dr in a debit or credit column makes the direction unclear.',
          });
        } else if (present(chosen)) {
          amountMinor = chosen.amount.minorUnits;
          direction = present(debit) ? 'debit' : 'credit';
        }
      }
    }
  }

  if (description === '' && counterparty === '') {
    problems.push({ field: 'description', message: 'The row has no description.' });
  }

  return {
    ...(parsedDate === undefined ? {} : { date: parsedDate.date }),
    ...(parsedDate?.time === undefined ? {} : { time: parsedDate.time }),
    ...(amountMinor === undefined ? {} : { amountMinor }),
    ...(direction === undefined ? {} : { direction }),
    description,
    ...(reference === '' ? {} : { reference }),
    ...(counterparty === '' ? {} : { counterparty }),
    problems,
  };
}

// --- Proposals -----------------------------------------------------------------------------------

const HEADER_NAMES = {
  date: [
    'date',
    'txn date',
    'transaction date',
    'value date',
    'posting date',
    'posted date',
    'tran date',
    'booking date',
  ],
  description: [
    'description',
    'narration',
    'particulars',
    'details',
    'remarks',
    'transaction details',
    'memo',
    'transaction remarks',
  ],
  debit: [
    'debit',
    'debit amount',
    'withdrawal',
    'withdrawals',
    'withdrawal amt',
    'withdrawal amount',
    'dr',
    'money out',
    'paid out',
  ],
  credit: [
    'credit',
    'credit amount',
    'deposit',
    'deposits',
    'deposit amt',
    'deposit amount',
    'cr',
    'money in',
    'paid in',
  ],
  amount: ['amount', 'transaction amount', 'amt', 'value'],
  reference: [
    'reference',
    'ref',
    'ref no',
    'ref no.',
    'reference no',
    'reference number',
    'chq/ref no',
    'chq./ref.no.',
    'cheque no',
    'utr',
    'transaction id',
    'txn id',
  ],
  counterparty: ['payee', 'payer', 'merchant', 'beneficiary', 'counterparty', 'name', 'party'],
} as const;

function normaliseHeader(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[()]/g, '')
    .trim();
}

function columnNamed(columns: readonly string[], names: readonly string[]): number | undefined {
  const normalised = columns.map(normaliseHeader);
  const exact = normalised.findIndex((name) => names.includes(name));
  if (exact >= 0) return exact;
  const partial = normalised.findIndex((name) =>
    names.some((candidate) => candidate.length > 3 && name.includes(candidate)),
  );
  return partial >= 0 ? partial : undefined;
}

/**
 * Mapping suggested from header names, the date layouts that fit the sample dates, and the decimal
 * separator the sample amounts use. The person confirms or changes everything; in particular the
 * sign convention of a single amount column is never proposed.
 */
export function proposeSettings(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): ProposedImportSettings {
  const date = columnNamed(columns, HEADER_NAMES.date);
  const description = columnNamed(columns, HEADER_NAMES.description);
  const debitColumn = columnNamed(columns, HEADER_NAMES.debit);
  const creditColumn = columnNamed(columns, HEADER_NAMES.credit);
  const amountColumn =
    debitColumn === undefined || creditColumn === undefined
      ? columnNamed(columns, HEADER_NAMES.amount)
      : undefined;
  const reference = columnNamed(columns, HEADER_NAMES.reference);
  const counterparty = columnNamed(columns, HEADER_NAMES.counterparty);

  const sample = rows.slice(0, 200);
  const dateFormats =
    date === undefined ? [] : likelyDateFormats(sample.map((row) => row[date] ?? ''));

  const amountCells = [debitColumn, creditColumn, amountColumn]
    .filter((column) => column !== undefined)
    .flatMap((column) => sample.map((row) => (row[column] ?? '').trim()))
    .filter((value) => value !== '');
  const commaDecimal = amountCells.filter(
    (value) => /\d,\d{1,3}$/.test(value) && !/\.\d{1,3}$/.test(value),
  );
  const dotDecimal = amountCells.filter((value) => /\.\d{1,3}$/.test(value));
  const decimalSeparator: DecimalSeparator | undefined =
    dotDecimal.length > 0 && commaDecimal.every((value) => /\d{1,3}(?:,\d{3})+$/.test(value))
      ? '.'
      : commaDecimal.length > 0 && dotDecimal.length === 0
        ? ','
        : amountCells.length > 0
          ? '.'
          : undefined;

  const mapping: ProposedImportSettings['mapping'] = {
    ...(date === undefined ? {} : { date }),
    ...(description === undefined ? {} : { description }),
    ...(debitColumn === undefined || creditColumn === undefined
      ? {}
      : { debitColumn, creditColumn }),
    ...(amountColumn === undefined ? {} : { amountColumn }),
    ...(reference === undefined ? {} : { reference }),
    ...(counterparty === undefined || counterparty === description ? {} : { counterparty }),
  };
  return {
    mapping,
    dateFormats,
    ...(decimalSeparator === undefined ? {} : { decimalSeparator }),
  };
}

/** Whether the first record looks like column names rather than data. */
export function looksLikeHeader(
  first: readonly string[],
  second: readonly string[] | undefined,
): boolean {
  const hasData = (record: readonly string[]): boolean =>
    record.some((value) => /\d/.test(value) && matchingDateFormats([value]).length > 0) ||
    record.some((value) => /^-?[\d,.\s]+$/.test(value.trim()) && /\d/.test(value));
  return !hasData(first) && (second === undefined || hasData(second));
}

/** Lower case, letters only, single spaces: the same entry reads the same across statements. */
export function descriptionKey(description: string, counterparty: string | undefined): string {
  return `${counterparty ?? ''} ${description}`
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
