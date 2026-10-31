import {
  ADJUSTMENT_DIRECTIONS,
  createTransactionInputSchema,
  describeDecimalAmountError,
  formatDecimalAmount,
  getAccountClassification,
  instantToZonedDateTime,
  isoDateSchema,
  isWallClockTime,
  normalizeTags,
  parseDecimalAmount,
  parseMinorUnits,
  PAYMENT_METHODS,
  reconciliationPreviewInputSchema,
  requiresNonNegativeBalance,
  serializeMinorUnits,
  TRANSACTION_TYPES,
  zonedDateTimeToInstant,
  type AdjustmentDirection,
  type CreateTransactionInput,
  type PaymentMethod,
  type ReconciliationPreviewInput,
  type TransactionAccountRefDto,
  type TransactionDraftDto,
  type TransactionDto,
  type TransactionType,
  type UpdateTransactionInput,
} from '@calmcash/shared';

import type { FieldErrors } from '@/lib/form-errors';

// The transaction forms work with the text a person typed; this module converts it to the API's
// exact contracts (and back) with the same shared schemas the API uses. Amounts are parsed in the
// account's currency without floating point, and dates are read in the user's time zone, never the
// browser's. No React here.

export const TRANSACTION_FORM_FIELDS = [
  'type',
  'accountId',
  'transferAccountId',
  'amount',
  'date',
  'time',
  'description',
  'merchant',
  'categoryId',
  'paymentMethod',
  'adjustmentDirection',
  'notes',
  'tags',
] as const;

export type TransactionFormField = (typeof TRANSACTION_FORM_FIELDS)[number];
/** `tags` holds the normalised tags joined by commas. */
export type TransactionFormValues = Record<TransactionFormField, string>;
export type TransactionFormErrors = FieldErrors<TransactionFormField>;

export type FormResult<TInput, TField extends string = TransactionFormField> =
  { ok: true; input: TInput } | { ok: false; errors: FieldErrors<TField> };

/** What the forms need to know about an account (an `AccountDto` fits). */
export type FormAccount = TransactionAccountRefDto;

export function isTransactionType(value: string): value is TransactionType {
  return TRANSACTION_TYPES.some((type) => type === value);
}

function isPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHODS.some((method) => method === value);
}

function isAdjustmentDirection(value: string): value is AdjustmentDirection {
  return ADJUSTMENT_DIRECTIONS.some((direction) => direction === value);
}

export function splitTags(value: string): string[] {
  return normalizeTags(value.split(','));
}

export function emptyTransactionFormValues(
  type: TransactionType,
  timeZone: string,
  now: Date,
  accountId = '',
): TransactionFormValues {
  const { date, time } = instantToZonedDateTime(now, timeZone);
  return {
    type,
    accountId,
    transferAccountId: '',
    amount: '',
    date,
    time,
    description: '',
    merchant: '',
    categoryId: '',
    paymentMethod: '',
    adjustmentDirection: '',
    notes: '',
    tags: '',
  };
}

/** Form values that show a stored transaction exactly as it is. */
export function transactionToFormValues(
  transaction: TransactionDto,
  timeZone: string,
): TransactionFormValues {
  const { date, time } = instantToZonedDateTime(new Date(transaction.occurredAt), timeZone);
  const values: TransactionFormValues = {
    ...emptyTransactionFormValues(transaction.type, timeZone, new Date(transaction.occurredAt)),
    accountId: transaction.accountId,
    amount: formatDecimalAmount(parseMinorUnits(transaction.amountMinor), transaction.currency),
    date,
    time,
    description: transaction.description,
    notes: transaction.notes ?? '',
    tags: transaction.tags.join(','),
  };
  switch (transaction.type) {
    case 'income':
    case 'expense':
      return {
        ...values,
        merchant: transaction.merchant ?? '',
        categoryId: transaction.categoryId ?? '',
        paymentMethod: transaction.paymentMethod ?? '',
      };
    case 'transfer':
      return {
        ...values,
        transferAccountId: transaction.transferAccountId,
        paymentMethod: transaction.paymentMethod ?? '',
      };
    case 'balance_adjustment':
      return { ...values, adjustmentDirection: transaction.adjustmentDirection };
  }
}

/**
 * Form values for a draft the assistant read from the person's words. Every field stays editable
 * and is checked again on save; nothing in a draft is recorded until the person saves the form.
 * Without a time in the text, the current time is used (on the draft's date).
 */
export function draftToFormValues(
  draft: TransactionDraftDto,
  timeZone: string,
  now: Date,
): TransactionFormValues {
  const empty = emptyTransactionFormValues(draft.type, timeZone, now, draft.accountId ?? '');
  return {
    ...empty,
    transferAccountId: draft.transferAccountId ?? '',
    amount: draft.amount ?? '',
    date: draft.date ?? empty.date,
    time: draft.time ?? empty.time,
    description: draft.description ?? '',
    merchant: draft.type === 'transfer' ? '' : (draft.merchant ?? ''),
    categoryId: draft.type === 'transfer' ? '' : (draft.categoryId ?? ''),
    paymentMethod: draft.paymentMethod ?? '',
    notes: draft.notes ?? '',
    tags: normalizeTags(draft.tags).join(','),
  };
}

/** API and schema paths (`body.amountMinor`, `occurredAt`) mapped onto form fields. */
export function transactionFieldForPath(path: string): TransactionFormField | undefined {
  const key = path.replace(/^body\./, '').split('.')[0] ?? '';
  switch (key) {
    case 'amountMinor':
      return 'amount';
    case 'occurredAt':
      return 'date';
    default:
      return TRANSACTION_FORM_FIELDS.find((field) => field === key);
  }
}

export function transactionErrorsFromPaths(
  issues: readonly { path: string; message: string }[],
): TransactionFormErrors {
  const errors: TransactionFormErrors = {};
  for (const issue of issues) {
    const field = transactionFieldForPath(issue.path);
    if (field !== undefined && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

/** The instant of the date and time fields in the user's time zone, or the field problems. */
function occurredAtFrom(
  values: Pick<TransactionFormValues, 'date' | 'time'>,
  timeZone: string,
): { ok: true; occurredAt: string } | { ok: false; errors: { date?: string; time?: string } } {
  const errors: { date?: string; time?: string } = {};
  if (!isoDateSchema.safeParse(values.date).success) {
    errors.date = 'Choose a date.';
  }
  if (!isWallClockTime(values.time)) {
    errors.time = 'Choose a time.';
  }
  if (errors.date !== undefined || errors.time !== undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    occurredAt: zonedDateTimeToInstant(values.date, values.time, timeZone).toISOString(),
  };
}

const FRIENDLY_MESSAGES = {
  amount: 'Enter an amount above zero.',
  accountId: 'Choose an account.',
  transferAccountId: 'Choose where the money goes.',
  categoryId: 'Choose a category.',
} as const;

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Builds the create request, validated with the same shared schema as the API. */
export function buildCreateTransactionInput(
  values: TransactionFormValues,
  accounts: readonly FormAccount[],
  timeZone: string,
): FormResult<CreateTransactionInput> {
  const errors: TransactionFormErrors = {};
  const type = isTransactionType(values.type) ? values.type : undefined;
  if (type === undefined) {
    return { ok: false, errors: { type: 'Choose what kind of transaction this is.' } };
  }
  const account = accounts.find((candidate) => candidate.id === values.accountId);
  if (account === undefined) {
    errors.accountId =
      type === 'transfer' ? 'Choose where the money comes from.' : 'Choose an account.';
  }

  let amountMinor = '';
  if (account !== undefined) {
    const parsed = parseDecimalAmount(values.amount, account.currency);
    if (!parsed.ok) {
      errors.amount =
        parsed.error === 'empty' || parsed.error === 'negative'
          ? 'Enter an amount above zero.'
          : describeDecimalAmountError(parsed.error, account.currency);
    } else if (parsed.minorUnits === 0n) {
      errors.amount = 'Enter an amount above zero.';
    } else {
      amountMinor = serializeMinorUnits(parsed.minorUnits);
    }
  }

  const when = occurredAtFrom(values, timeZone);
  if (!when.ok) {
    Object.assign(errors, when.errors);
  }

  if (type === 'transfer' && account !== undefined) {
    const destination = accounts.find((candidate) => candidate.id === values.transferAccountId);
    if (destination === undefined) {
      errors.transferAccountId = 'Choose where the money goes.';
    } else if (destination.id === account.id) {
      errors.transferAccountId = 'Choose two different accounts.';
    } else if (destination.currency !== account.currency) {
      errors.transferAccountId = `Transfers stay within one currency; ${account.name} uses ${account.currency}.`;
    }
  }

  const common = {
    accountId: values.accountId,
    amountMinor,
    occurredAt: when.ok ? when.occurredAt : '',
    ...(optionalText(values.notes) === undefined ? {} : { notes: values.notes }),
    ...(splitTags(values.tags).length === 0 ? {} : { tags: splitTags(values.tags) }),
  };
  const paymentMethod = isPaymentMethod(values.paymentMethod)
    ? { paymentMethod: values.paymentMethod }
    : {};
  let candidate: Record<string, unknown>;
  switch (type) {
    case 'income':
    case 'expense':
      candidate = {
        ...common,
        type,
        description: values.description,
        categoryId: values.categoryId,
        ...(optionalText(values.merchant) === undefined ? {} : { merchant: values.merchant }),
        ...paymentMethod,
      };
      break;
    case 'transfer':
      candidate = {
        ...common,
        type,
        transferAccountId: values.transferAccountId,
        ...(optionalText(values.description) === undefined
          ? {}
          : { description: values.description }),
        ...paymentMethod,
      };
      break;
    case 'balance_adjustment':
      candidate = {
        ...common,
        type,
        description: values.description,
        ...(isAdjustmentDirection(values.adjustmentDirection)
          ? { adjustmentDirection: values.adjustmentDirection }
          : {}),
      };
      break;
  }

  const result = createTransactionInputSchema.safeParse(candidate);
  if (!result.success) {
    const schemaErrors = transactionErrorsFromPaths(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
    // Missing selections read better as instructions than as format errors.
    for (const field of ['amount', 'accountId', 'transferAccountId', 'categoryId'] as const) {
      if (schemaErrors[field] !== undefined) {
        schemaErrors[field] = FRIENDLY_MESSAGES[field];
      }
    }
    // Problems found while reading the text come first; they are the more specific ones.
    return { ok: false, errors: { ...schemaErrors, ...errors } };
  }
  if (Object.values(errors).some((message) => message !== undefined)) {
    return { ok: false, errors };
  }
  return { ok: true, input: result.data };
}

function merchantOf(transaction: CreateTransactionInput | TransactionDto): string | undefined {
  return transaction.type === 'income' || transaction.type === 'expense'
    ? transaction.merchant
    : undefined;
}

function categoryOf(transaction: CreateTransactionInput | TransactionDto): string | undefined {
  return transaction.type === 'income' || transaction.type === 'expense'
    ? transaction.categoryId
    : undefined;
}

function paymentMethodOf(
  transaction: CreateTransactionInput | TransactionDto,
): PaymentMethod | undefined {
  return transaction.type === 'balance_adjustment' ? undefined : transaction.paymentMethod;
}

function destinationOf(transaction: CreateTransactionInput | TransactionDto): string | undefined {
  return transaction.type === 'transfer' ? transaction.transferAccountId : undefined;
}

function directionOf(
  transaction: CreateTransactionInput | TransactionDto,
): AdjustmentDirection | undefined {
  return transaction.type === 'balance_adjustment' ? transaction.adjustmentDirection : undefined;
}

/**
 * Builds a minimal update: only what changed, with `null` for every field the (possibly new) type
 * no longer uses, so the API never has to guess. `input` is `undefined` when nothing changed.
 */
export function buildUpdateTransactionInput(
  current: TransactionDto,
  values: TransactionFormValues,
  accounts: readonly FormAccount[],
  timeZone: string,
): FormResult<UpdateTransactionInput | undefined> {
  const built = buildCreateTransactionInput(values, accounts, timeZone);
  if (!built.ok) {
    return built;
  }
  const next = built.input;
  const changes: UpdateTransactionInput = {};

  if (next.type !== current.type) changes.type = next.type;
  if (next.accountId !== current.accountId) changes.accountId = next.accountId;
  if (next.amountMinor !== current.amountMinor) changes.amountMinor = next.amountMinor;

  const original = instantToZonedDateTime(new Date(current.occurredAt), timeZone);
  if (original.date !== values.date || original.time !== values.time) {
    changes.occurredAt = next.occurredAt;
  }
  // A transfer's description may be left empty; the stored one then stays as it is.
  if (next.description !== undefined && next.description !== current.description) {
    changes.description = next.description;
  }
  if (destinationOf(next) !== destinationOf(current)) {
    changes.transferAccountId = destinationOf(next) ?? null;
  }
  if (merchantOf(next) !== merchantOf(current)) changes.merchant = merchantOf(next) ?? null;
  if (categoryOf(next) !== categoryOf(current)) changes.categoryId = categoryOf(next) ?? null;
  if (paymentMethodOf(next) !== paymentMethodOf(current)) {
    changes.paymentMethod = paymentMethodOf(next) ?? null;
  }
  if (directionOf(next) !== directionOf(current)) {
    changes.adjustmentDirection = directionOf(next) ?? null;
  }
  if (next.notes !== current.notes) changes.notes = next.notes ?? null;
  const tags = next.tags ?? [];
  if (tags.join(',') !== current.tags.join(',')) changes.tags = tags;

  return { ok: true, input: Object.keys(changes).length === 0 ? undefined : changes };
}

// --- Balance reconciliation -----------------------------------------------------------------------

export const RECONCILE_FORM_FIELDS = [
  'accountId',
  'observed',
  'date',
  'time',
  'description',
  'notes',
] as const;

export type ReconcileFormField = (typeof RECONCILE_FORM_FIELDS)[number];
export type ReconcileFormValues = Record<ReconcileFormField, string>;

/**
 * Builds the preview request. Accounts that hold money take the balance the bank or cash count
 * shows; cards and other debts take the amount owed (negative when in credit), which becomes the
 * API's signed net position.
 */
export function buildReconciliationInput(
  values: ReconcileFormValues,
  accounts: readonly FormAccount[],
  timeZone: string,
): FormResult<ReconciliationPreviewInput, ReconcileFormField> {
  const errors: FieldErrors<ReconcileFormField> = {};
  const account = accounts.find((candidate) => candidate.id === values.accountId);
  let observedBalanceMinor = '';
  if (account === undefined) {
    errors.accountId = 'Choose the account to check.';
  } else {
    const owed = getAccountClassification(account.type) === 'liability';
    const parsed = parseDecimalAmount(values.observed, account.currency, {
      allowNegative: owed || !requiresNonNegativeBalance(account.type),
    });
    if (!parsed.ok) {
      errors.observed =
        parsed.error === 'negative'
          ? 'This type of account cannot have a negative balance.'
          : parsed.error === 'empty'
            ? 'Enter the balance you see (0 is fine).'
            : describeDecimalAmountError(parsed.error, account.currency);
    } else {
      observedBalanceMinor = serializeMinorUnits(owed ? -parsed.minorUnits : parsed.minorUnits);
    }
  }
  const when = occurredAtFrom(values, timeZone);
  if (!when.ok) {
    Object.assign(errors, when.errors);
  }
  if (values.description.trim() === '') {
    errors.description = 'Explain why the balance needs correcting.';
  }
  if (Object.values(errors).some((message) => message !== undefined) || !when.ok) {
    return { ok: false, errors };
  }
  const result = reconciliationPreviewInputSchema.safeParse({
    accountId: values.accountId,
    observedBalanceMinor,
    asOf: when.occurredAt,
  });
  if (!result.success) {
    const field = (path: string): ReconcileFormField | undefined =>
      path === 'observedBalanceMinor'
        ? 'observed'
        : path === 'asOf'
          ? 'date'
          : RECONCILE_FORM_FIELDS.find((name) => name === path);
    for (const issue of result.error.issues) {
      const name = field(issue.path.map(String).join('.'));
      if (name !== undefined) {
        errors[name] ??= issue.message;
      }
    }
    return { ok: false, errors };
  }
  return { ok: true, input: result.data };
}
