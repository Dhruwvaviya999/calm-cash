import {
  describeDecimalAmountError,
  getAccountClassification,
  IMPORT_DATE_FORMATS,
  importSettingsInputSchema,
  minorUnitsToDecimalString,
  parseDecimalAmount,
  parseMinorUnits,
  serializeMinorUnits,
  SIGN_CONVENTIONS,
  type AccountType,
  type CurrencyCode,
  type ImportBatchDetailDto,
  type ImportDateFormat,
  type ImportSettingsInput,
  type SignConvention,
  type StatementInfo,
} from '@calmcash/shared';

import type { FieldErrors } from '@/lib/form-errors';

// The column-mapping form: what the person chose → the API's exact settings contract. Nothing is
// guessed here: a date layout or sign convention that was not chosen is an error, not a default.

export const MAPPING_FIELDS = [
  'date',
  'description',
  'counterparty',
  'reference',
  'amount',
  'convention',
  'debit',
  'credit',
  'dateFormat',
  'periodStart',
  'periodEnd',
  'openingBalance',
  'closingBalance',
] as const;

export type MappingField = (typeof MAPPING_FIELDS)[number];

export interface MappingFormValues {
  /** Zero-based column positions as strings; `''` means "not in this statement". */
  date: string;
  description: string;
  counterparty: string;
  reference: string;
  amountMode: 'signed' | 'split';
  amount: string;
  convention: SignConvention | '';
  debit: string;
  credit: string;
  dateFormat: ImportDateFormat | '';
  decimalSeparator: '.' | ',';
  periodStart: string;
  periodEnd: string;
  /** Typed balances; for cards and loans, the amount owed (entered as a positive number). */
  openingBalance: string;
  closingBalance: string;
}

export type MappingFormErrors = FieldErrors<MappingField>;

export type MappingBuildResult =
  { ok: true; input: ImportSettingsInput } | { ok: false; errors: MappingFormErrors };

/** Cards and loans: statement balances are entered as the amount owed. */
export function balancesAreOwed(type: AccountType): boolean {
  return getAccountClassification(type) === 'liability';
}

function column(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function balanceText(value: string | undefined, currency: CurrencyCode, owed: boolean): string {
  if (value === undefined) {
    return '';
  }
  const minor = parseMinorUnits(value);
  return minorUnitsToDecimalString(owed ? -minor : minor, currency);
}

/** The saved settings, or else what the API proposed from the header and sample values. */
export function initialMappingValues(batch: ImportBatchDetailDto): MappingFormValues {
  const owed = balancesAreOwed(batch.account.type);
  const statement = {
    periodStart: batch.statement.periodStart ?? '',
    periodEnd: batch.statement.periodEnd ?? '',
    openingBalance: balanceText(batch.statement.openingBalanceMinor, batch.currency, owed),
    closingBalance: balanceText(batch.statement.closingBalanceMinor, batch.currency, owed),
  };
  const { settings } = batch;
  if (settings !== undefined) {
    const { mapping } = settings;
    return {
      date: String(mapping.date),
      description: String(mapping.description),
      counterparty: column(mapping.counterparty),
      reference: column(mapping.reference),
      amountMode: mapping.amount.mode,
      amount: mapping.amount.mode === 'signed' ? String(mapping.amount.column) : '',
      convention: mapping.amount.mode === 'signed' ? mapping.amount.convention : '',
      debit: mapping.amount.mode === 'split' ? String(mapping.amount.debitColumn) : '',
      credit: mapping.amount.mode === 'split' ? String(mapping.amount.creditColumn) : '',
      dateFormat: settings.dateFormat,
      decimalSeparator: settings.decimalSeparator,
      ...statement,
    };
  }
  const { mapping, dateFormats, decimalSeparator } = batch.proposed;
  const split =
    mapping.amountColumn === undefined &&
    (mapping.debitColumn !== undefined || mapping.creditColumn !== undefined);
  const [onlyFormat] = dateFormats;
  return {
    date: column(mapping.date),
    description: column(mapping.description),
    counterparty: column(mapping.counterparty),
    reference: column(mapping.reference),
    amountMode: split ? 'split' : 'signed',
    amount: column(mapping.amountColumn),
    // Banks differ on what a negative amount means, so the person always says which it is.
    convention: '',
    debit: column(mapping.debitColumn),
    credit: column(mapping.creditColumn),
    // Several layouts fit (e.g. 03/04/2026): the person chooses. Exactly one: it is preselected.
    dateFormat: dateFormats.length === 1 && onlyFormat !== undefined ? onlyFormat : '',
    decimalSeparator: decimalSeparator ?? '.',
    ...statement,
  };
}

function isDateFormat(value: string): value is ImportDateFormat {
  return IMPORT_DATE_FORMATS.some((format) => format === value);
}

function isConvention(value: string): value is SignConvention {
  return SIGN_CONVENTIONS.some((convention) => convention === value);
}

type ColumnField =
  'date' | 'description' | 'counterparty' | 'reference' | 'amount' | 'debit' | 'credit';

const FIELD_NAMES: Readonly<Record<ColumnField, string>> = {
  date: 'date',
  description: 'description',
  counterparty: 'payee',
  reference: 'reference',
  amount: 'amount',
  debit: 'money out',
  credit: 'money in',
};

/**
 * Checks the form and builds the settings request. Every problem is reported at once, on the
 * field it concerns.
 */
export function buildSettingsInput(
  values: MappingFormValues,
  {
    columnCount,
    currency,
    accountType,
  }: { columnCount: number; currency: CurrencyCode; accountType: AccountType },
): MappingBuildResult {
  const errors: MappingFormErrors = {};
  const columns = new Map<ColumnField, number>();
  const pick = (field: ColumnField, required: string | undefined): void => {
    const text = values[field];
    if (text === '') {
      if (required !== undefined) errors[field] = required;
      return;
    }
    const index = Number(text);
    if (!Number.isInteger(index) || index < 0 || index >= columnCount) {
      errors[field] = 'Choose a column of this statement.';
      return;
    }
    columns.set(field, index);
  };
  pick('date', 'Choose the column with the date.');
  pick('description', 'Choose the column with the description.');
  pick('counterparty', undefined);
  pick('reference', undefined);
  if (values.amountMode === 'signed') {
    pick('amount', 'Choose the column with the amount.');
    if (!isConvention(values.convention)) {
      errors.convention = 'Say what a negative amount means in this statement.';
    }
  } else {
    pick('debit', 'Choose the column with money out.');
    pick('credit', 'Choose the column with money in.');
  }

  // A column holds one kind of value (the payee or reference may repeat the description).
  const exclusive: readonly ColumnField[] =
    values.amountMode === 'signed'
      ? ['date', 'description', 'amount']
      : ['date', 'description', 'debit', 'credit'];
  const seen = new Map<number, ColumnField>();
  for (const field of exclusive) {
    const index = columns.get(field);
    if (index === undefined) continue;
    const other = seen.get(index);
    if (other !== undefined) {
      errors[field] = `This column is already used for the ${FIELD_NAMES[other]}.`;
    } else {
      seen.set(index, field);
    }
  }

  if (!isDateFormat(values.dateFormat)) {
    errors.dateFormat = 'Choose how dates are written in this statement.';
  }

  // The statement as a whole: optional, but what is entered must be exact.
  const statement: StatementInfo = {};
  if (values.periodStart !== '') statement.periodStart = values.periodStart;
  if (values.periodEnd !== '') statement.periodEnd = values.periodEnd;
  if (
    statement.periodStart !== undefined &&
    statement.periodEnd !== undefined &&
    statement.periodEnd < statement.periodStart
  ) {
    errors.periodEnd = 'The statement must end on or after its start.';
  }
  const owed = balancesAreOwed(accountType);
  for (const [field, key] of [
    ['openingBalance', 'openingBalanceMinor'],
    ['closingBalance', 'closingBalanceMinor'],
  ] as const) {
    const text = values[field];
    if (text.trim() === '') continue;
    const parsed = parseDecimalAmount(text, currency, { allowNegative: true });
    if (!parsed.ok) {
      errors[field] = describeDecimalAmountError(parsed.error, currency);
      continue;
    }
    statement[key] = serializeMinorUnits(owed ? -parsed.minorUnits : parsed.minorUnits);
  }
  // A balance is only comparable at a known instant.
  if (statement.openingBalanceMinor !== undefined && statement.periodStart === undefined) {
    errors.periodStart = 'Enter the first day of the statement for its opening balance.';
  }
  if (statement.closingBalanceMinor !== undefined && statement.periodEnd === undefined) {
    errors.periodEnd = 'Enter the last day of the statement for its closing balance.';
  }

  const date = columns.get('date');
  const description = columns.get('description');
  const amount = columns.get('amount');
  const debit = columns.get('debit');
  const credit = columns.get('credit');
  if (
    Object.keys(errors).length > 0 ||
    date === undefined ||
    description === undefined ||
    !isDateFormat(values.dateFormat)
  ) {
    return { ok: false, errors };
  }
  let amountMapping: ImportSettingsInput['settings']['mapping']['amount'];
  if (values.amountMode === 'signed' && amount !== undefined && isConvention(values.convention)) {
    amountMapping = { mode: 'signed', column: amount, convention: values.convention };
  } else if (values.amountMode === 'split' && debit !== undefined && credit !== undefined) {
    amountMapping = { mode: 'split', debitColumn: debit, creditColumn: credit };
  } else {
    return { ok: false, errors: { amount: 'Choose the column with the amount.' } };
  }
  const counterparty = columns.get('counterparty');
  const reference = columns.get('reference');
  const input: ImportSettingsInput = {
    settings: {
      dateFormat: values.dateFormat,
      decimalSeparator: values.decimalSeparator,
      mapping: {
        date,
        description,
        amount: amountMapping,
        ...(counterparty === undefined ? {} : { counterparty }),
        ...(reference === undefined ? {} : { reference }),
      },
    },
    statement,
  };
  // The shared contract has the final word, so the form can never send what the API refuses.
  const checked = importSettingsInputSchema.safeParse(input);
  return checked.success
    ? { ok: true, input: checked.data }
    : { ok: false, errors: { dateFormat: 'Some settings are not valid. Check each field.' } };
}

/** Plain-words names for the date layouts, with an example. */
export const DATE_FORMAT_EXAMPLES: Readonly<Record<ImportDateFormat, string>> = {
  'YYYY-MM-DD': '2026-04-03',
  'YYYY/MM/DD': '2026/04/03',
  'DD/MM/YYYY': '03/04/2026 (day first)',
  'MM/DD/YYYY': '04/03/2026 (month first)',
  'DD-MM-YYYY': '03-04-2026 (day first)',
  'MM-DD-YYYY': '04-03-2026 (month first)',
  'DD.MM.YYYY': '03.04.2026',
  'DD/MM/YY': '03/04/26 (day first)',
  'MM/DD/YY': '04/03/26 (month first)',
  'DD-MMM-YYYY': '03-Apr-2026',
  'DD MMM YYYY': '03 Apr 2026',
  'DD-MMM-YY': '03-Apr-26',
};
