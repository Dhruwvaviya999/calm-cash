import {
  calendarDateInTimeZone,
  categoryKindForTransactionType,
  createTransactionInputSchema,
  currencyCodeSchema,
  DEFAULT_TRANSFER_DESCRIPTION,
  parseMinorUnits,
  requiresNonNegativeBalance,
  TRANSACTION_TYPES,
  TYPE_SPECIFIC_TRANSACTION_FIELDS,
  type ApiErrorDetail,
  type CreateTransactionInput,
  type ReconciliationPreviewInput,
  type TransactionType,
  type UpdateTransactionInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import {
  adjustmentBetween,
  breaksNonNegativeRule,
  calculateCurrentBalance,
  NO_MOVEMENTS,
  toIsoDate,
  type BalanceAdjustment,
  type MovementTotals,
} from '../accounts';
import type {
  CategoryRecord,
  LockedAccount,
  TransactionRecord,
  TransactionWrite,
} from './transactions.repository';

// The business rules of a transaction write, as pure functions over already-loaded (and locked)
// data. The service loads; these decide. Nothing here touches the database.

const TYPE_NAMES: Readonly<Record<TransactionType, string>> = {
  income: 'income',
  expense: 'expenses',
  transfer: 'transfers',
  balance_adjustment: 'balance adjustments',
};

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

/** The stored transaction as the fields of a create request (absent rather than null). */
export function recordToInputState(record: TransactionRecord): Record<string, unknown> {
  const optional = (key: string, value: unknown): Record<string, unknown> =>
    value === null ? {} : { [key]: value };
  return {
    type: record.type,
    accountId: record.accountId,
    amountMinor: record.amountMinor.toString(),
    occurredAt: record.occurredAt.toISOString(),
    description: record.description,
    tags: [...record.tags],
    ...optional('notes', record.notes),
    ...optional('transferAccountId', record.transferAccountId),
    ...optional('merchant', record.merchant),
    ...optional('categoryId', record.categoryId),
    ...optional('paymentMethod', record.paymentMethod),
    ...optional('adjustmentDirection', record.adjustmentDirection),
  };
}

export type MergeResult =
  { ok: true; input: CreateTransactionInput } | { ok: false; details: ApiErrorDetail[] };

/**
 * Applies a partial update to a stored transaction and validates the result as a complete
 * transaction of its (possibly new) type. A field the type does not use is reported, never dropped:
 * changing an expense into a transfer must clear its merchant and category with `null`.
 */
export function mergeTransactionUpdate(
  record: TransactionRecord,
  patch: UpdateTransactionInput,
): MergeResult {
  // `null` clears a field, a value replaces it, and anything not mentioned is kept.
  const state = Object.fromEntries(
    Object.entries({ ...recordToInputState(record), ...patch }).filter(
      ([, value]) => value !== null,
    ),
  );

  const result = createTransactionInputSchema.safeParse(state);
  if (result.success) {
    return { ok: true, input: result.data };
  }
  const type = TRANSACTION_TYPES.find((candidate) => candidate === state.type) ?? record.type;
  const typeName = TYPE_NAMES[type];
  const details = result.error.issues.flatMap((issue): ApiErrorDetail[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: `body.${key}`,
        message: TYPE_SPECIFIC_TRANSACTION_FIELDS.some((field) => field === key)
          ? `Not used for ${typeName}. Send null to remove it.`
          : 'Unknown field.',
      }));
    }
    return [{ path: ['body', ...issue.path.map(String)].join('.'), message: issue.message }];
  });
  return { ok: false, details };
}

export interface WriteContext {
  accounts: ReadonlyMap<string, LockedAccount>;
  /** The selected category, if the input names one (null when it does not exist for the user). */
  category: CategoryRecord | null;
  /** The transaction being edited, if any. */
  existing?: TransactionRecord;
  timeZone: string;
  now: Date;
}

function accountFor(
  context: WriteContext,
  accountId: string,
  path: 'accountId' | 'transferAccountId',
): LockedAccount {
  const account = context.accounts.get(accountId);
  if (account === undefined) {
    throw invalid([{ path: `body.${path}`, message: 'Choose one of your accounts.' }]);
  }
  if (account.record.archivedAt !== null) {
    throw new AppError(
      409,
      'CONFLICT',
      `${account.record.name} is archived. Restore it before recording transactions on it.`,
      { details: [{ path: `body.${path}`, message: 'This account is archived.' }] },
    );
  }
  return account;
}

/** Edits never bypass the account rules: an archived account's history is read-only. */
export function assertAccountsWritable(
  accounts: ReadonlyMap<string, LockedAccount>,
  accountIds: readonly string[],
): void {
  for (const accountId of accountIds) {
    const account = accounts.get(accountId);
    if (account !== undefined && account.record.archivedAt !== null) {
      throw new AppError(
        409,
        'CONFLICT',
        `${account.record.name} is archived, so its transactions cannot change. Restore the account first.`,
      );
    }
  }
}

/** Account IDs a stored transaction affects. */
export function accountsOf(
  record: Pick<TransactionRecord, 'accountId' | 'transferAccountId'>,
): string[] {
  return record.transferAccountId === null
    ? [record.accountId]
    : [record.accountId, record.transferAccountId];
}

/** Account IDs a requested transaction affects. */
export function accountsOfInput(input: CreateTransactionInput): string[] {
  return input.type === 'transfer' ? [input.accountId, input.transferAccountId] : [input.accountId];
}

/**
 * Checks a complete transaction against the user's locked accounts and category and returns the
 * row to store. Rules: every account is the user's and active; a transfer stays within one
 * currency; the date is neither in the future nor before an account started counting; income and
 * expenses use an active category of the matching kind (an archived one may stay on an edit).
 */
export function planTransactionWrite(
  input: CreateTransactionInput,
  context: WriteContext,
): TransactionWrite {
  const source = accountFor(context, input.accountId, 'accountId');
  const destination =
    input.type === 'transfer'
      ? accountFor(context, input.transferAccountId, 'transferAccountId')
      : undefined;
  const currency = currencyCodeSchema.parse(source.record.currency);

  if (destination !== undefined && destination.record.currency !== source.record.currency) {
    throw invalid([
      {
        path: 'body.transferAccountId',
        message: `Transfers stay within one currency: ${source.record.name} uses ${source.record.currency} and ${destination.record.name} uses ${destination.record.currency}.`,
      },
    ]);
  }

  const occurredAt = new Date(input.occurredAt);
  if (
    calendarDateInTimeZone(occurredAt, context.timeZone) >
    calendarDateInTimeZone(context.now, context.timeZone)
  ) {
    throw invalid([{ path: 'body.occurredAt', message: 'The date cannot be in the future.' }]);
  }
  for (const account of [source, destination]) {
    if (account !== undefined && occurredAt < account.countsFrom) {
      throw invalid([
        {
          path: 'body.occurredAt',
          message: `${account.record.name} is tracked from ${toIsoDate(account.record.openingBalanceDate)}. Choose that day or later.`,
        },
      ]);
    }
  }

  let categoryId: string | null = null;
  const kind = categoryKindForTransactionType(input.type);
  if (kind !== undefined && (input.type === 'income' || input.type === 'expense')) {
    const category = context.category;
    if (category?.id !== input.categoryId) {
      throw invalid([{ path: 'body.categoryId', message: 'Choose one of your categories.' }]);
    }
    if (category.kind !== kind) {
      throw invalid([{ path: 'body.categoryId', message: `Choose an ${kind} category.` }]);
    }
    const unchanged = context.existing?.categoryId === category.id;
    if (category.archivedAt !== null && !unchanged) {
      throw invalid([
        {
          path: 'body.categoryId',
          message: `“${category.name}” is archived. Choose another category or restore it.`,
        },
      ]);
    }
    categoryId = category.id;
  }

  const common = {
    accountId: input.accountId,
    amountMinor: parseMinorUnits(input.amountMinor),
    currency,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    occurredAt,
  };
  switch (input.type) {
    case 'income':
    case 'expense':
      return {
        ...common,
        type: input.type,
        transferAccountId: null,
        description: input.description,
        merchant: input.merchant ?? null,
        categoryId,
        paymentMethod: input.paymentMethod ?? null,
        adjustmentDirection: null,
      };
    case 'transfer':
      return {
        ...common,
        type: 'transfer',
        transferAccountId: input.transferAccountId,
        description: input.description ?? DEFAULT_TRANSFER_DESCRIPTION,
        merchant: null,
        categoryId: null,
        paymentMethod: input.paymentMethod ?? null,
        adjustmentDirection: null,
      };
    case 'balance_adjustment':
      return {
        ...common,
        type: 'balance_adjustment',
        transferAccountId: null,
        description: input.description,
        merchant: null,
        categoryId: null,
        paymentMethod: null,
        adjustmentDirection: input.adjustmentDirection,
      };
  }
}

/**
 * Compares balances before and after a write (both read inside the same locked transaction) and
 * refuses the write if a cash, savings, or wallet account would end below zero and lower than it
 * was. Uses the authoritative balance calculation only.
 */
export function assertBalanceRules(
  accounts: ReadonlyMap<string, LockedAccount>,
  before: ReadonlyMap<string, MovementTotals>,
  after: ReadonlyMap<string, MovementTotals>,
  path: string | undefined,
): void {
  for (const [accountId, { record }] of accounts) {
    const was = calculateCurrentBalance(
      record.openingBalanceMinor,
      before.get(accountId) ?? NO_MOVEMENTS,
    );
    const now = calculateCurrentBalance(
      record.openingBalanceMinor,
      after.get(accountId) ?? NO_MOVEMENTS,
    );
    if (breaksNonNegativeRule(record.type, was, now)) {
      throw new AppError(
        409,
        'CONFLICT',
        `This would take ${record.name} below zero. Cash, savings, and wallet balances cannot be negative.`,
        path === undefined
          ? {}
          : { details: [{ path, message: `${record.name} does not have enough money for this.` }] },
      );
    }
  }
}

/**
 * Compares an observed balance with CalmCash's balance at the same instant (`totalsAtAsOf`) and
 * returns the adjustment that reconciles them, or `undefined` when they already match.
 */
export function evaluateReconciliation(
  account: LockedAccount,
  input: ReconciliationPreviewInput,
  totalsAtAsOf: MovementTotals,
  timeZone: string,
  now: Date,
): BalanceAdjustment | undefined {
  const { record, countsFrom } = account;
  if (record.archivedAt !== null) {
    throw new AppError(
      409,
      'CONFLICT',
      `${record.name} is archived. Restore it before correcting its balance.`,
    );
  }
  const asOf = new Date(input.asOf);
  if (calendarDateInTimeZone(asOf, timeZone) > calendarDateInTimeZone(now, timeZone)) {
    throw invalid([{ path: 'body.asOf', message: 'The date cannot be in the future.' }]);
  }
  if (asOf < countsFrom) {
    throw invalid([
      {
        path: 'body.asOf',
        message: `${record.name} is tracked from ${toIsoDate(record.openingBalanceDate)}. Choose that day or later.`,
      },
    ]);
  }
  const observed = parseMinorUnits(input.observedBalanceMinor);
  if (observed < 0n && requiresNonNegativeBalance(record.type)) {
    throw invalid([
      {
        path: 'body.observedBalanceMinor',
        message: 'This type of account cannot have a negative balance.',
      },
    ]);
  }
  return adjustmentBetween(
    calculateCurrentBalance(record.openingBalanceMinor, totalsAtAsOf),
    observed,
  );
}
