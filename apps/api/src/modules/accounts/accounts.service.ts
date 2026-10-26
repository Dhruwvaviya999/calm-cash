import {
  accountRuleViolations,
  calendarDateInTimeZone,
  currencyCodeSchema,
  getAccountClassification,
  parseMinorUnits,
  serializeMinorUnits,
  type AccountListDto,
  type AccountListQuery,
  type AccountSummaryDto,
  type AccountWithBalanceDto,
  type ApiErrorDetail,
  type CreateAccountInput,
  type UpdateAccountInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import { describeAccountBalance, NO_MOVEMENTS, summarizeBalances } from './account-balance';
import { fromIsoDate, toAccountDto, toIsoDate } from './accounts.mapper';
import type { AccountChanges, AccountRecord, AccountsRepository } from './accounts.repository';

/** Who is calling; provided by the authentication module, never by the request body. */
export interface Caller {
  userId: string;
  /** IANA time zone of the user, for "today" and opening-balance dates. */
  timeZone: string;
}

export interface AccountsService {
  list: (caller: Caller, query: AccountListQuery) => Promise<AccountListDto>;
  summary: (caller: Caller) => Promise<AccountSummaryDto>;
  get: (caller: Caller, accountId: string) => Promise<AccountWithBalanceDto>;
  create: (caller: Caller, input: CreateAccountInput) => Promise<AccountWithBalanceDto>;
  update: (
    caller: Caller,
    accountId: string,
    input: UpdateAccountInput,
  ) => Promise<AccountWithBalanceDto>;
  archive: (caller: Caller, accountId: string) => Promise<AccountWithBalanceDto>;
  restore: (caller: Caller, accountId: string) => Promise<AccountWithBalanceDto>;
}

export interface AccountsServiceDependencies {
  repository: AccountsRepository;
  now: () => Date;
}

// The same answer for "does not exist" and "belongs to someone else", so IDs reveal nothing.
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That account does not exist or is not yours.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

/** Today's calendar date in the caller's time zone, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date): string {
  return calendarDateInTimeZone(now, timeZone);
}

function assertNotInFuture(date: string, caller: Caller, now: Date): void {
  if (date > todayIn(caller.timeZone, now)) {
    throw invalid([
      {
        path: 'body.openingBalanceDate',
        message: 'The opening balance date cannot be in the future.',
      },
    ]);
  }
}

function assertRules(state: Parameters<typeof accountRuleViolations>[0]): void {
  const violations = accountRuleViolations(state);
  if (violations.length > 0) {
    throw invalid(
      violations.map((violation) => ({
        path: `body.${violation.path}`,
        message: violation.message,
      })),
    );
  }
}

/**
 * Decides the changes of an update against the locked, current account. Policy:
 * - archived accounts are read-only until restored;
 * - the type may change only within its classification (money held vs. money owed);
 * - once a transaction uses the account, the opening balance, its date, and the currency are
 *   locked, because changing them would silently rewrite the meaning of recorded history;
 * - a currency change must restate amounts in the new currency;
 * - type-specific rules are checked on the merged result.
 */
export function planAccountUpdate(
  current: AccountRecord,
  hasTransactions: boolean,
  input: UpdateAccountInput,
  caller: Caller,
  now: Date,
): AccountChanges {
  if (current.archivedAt !== null) {
    throw new AppError(409, 'CONFLICT', 'Restore this account before editing it.');
  }

  const type = input.type ?? current.type;
  if (getAccountClassification(type) !== getAccountClassification(current.type)) {
    throw invalid([
      {
        path: 'body.type',
        message:
          'An account cannot switch between money held and money owed. Archive it and add a new account instead.',
      },
    ]);
  }

  const currency = input.currency ?? currencyCodeSchema.parse(current.currency);
  const currencyChanged = currency !== current.currency;
  const openingBalanceMinor =
    input.openingBalanceMinor === undefined
      ? current.openingBalanceMinor
      : parseMinorUnits(input.openingBalanceMinor);
  const openingBalanceDate = input.openingBalanceDate ?? toIsoDate(current.openingBalanceDate);

  const financialChange =
    currencyChanged ||
    openingBalanceMinor !== current.openingBalanceMinor ||
    openingBalanceDate !== toIsoDate(current.openingBalanceDate);
  if (financialChange && hasTransactions) {
    throw new AppError(
      409,
      'CONFLICT',
      'This account already has transactions, so its opening balance, opening date, and currency can no longer change.',
    );
  }

  if (currencyChanged) {
    const details: ApiErrorDetail[] = [];
    if (input.openingBalanceMinor === undefined && current.openingBalanceMinor !== 0n) {
      details.push({
        path: 'body.openingBalanceMinor',
        message: 'Enter the opening balance again in the new currency.',
      });
    }
    if (input.creditLimitMinor === undefined && current.creditLimitMinor !== null) {
      details.push({
        path: 'body.creditLimitMinor',
        message: 'Enter the credit limit again in the new currency.',
      });
    }
    if (details.length > 0) {
      throw invalid(details);
    }
  }

  if (input.openingBalanceDate !== undefined) {
    assertNotInFuture(input.openingBalanceDate, caller, now);
  }

  const creditLimitMinor =
    input.creditLimitMinor === undefined
      ? current.creditLimitMinor
      : input.creditLimitMinor === null
        ? null
        : parseMinorUnits(input.creditLimitMinor);
  assertRules({
    type,
    openingBalanceMinor: serializeMinorUnits(openingBalanceMinor),
    creditLimitMinor: creditLimitMinor === null ? null : serializeMinorUnits(creditLimitMinor),
  });

  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.openingBalanceMinor === undefined ? {} : { openingBalanceMinor }),
    ...(input.openingBalanceDate === undefined
      ? {}
      : { openingBalanceDate: fromIsoDate(input.openingBalanceDate) }),
    ...(input.institution === undefined ? {} : { institution: input.institution }),
    ...(input.creditLimitMinor === undefined ? {} : { creditLimitMinor }),
    ...(input.color === undefined ? {} : { color: input.color }),
  };
}

export function createAccountsService({
  repository,
  now,
}: AccountsServiceDependencies): AccountsService {
  /** Balances for the given accounts, from one aggregate query for the user. */
  const withBalances = async (
    userId: string,
    accounts: readonly AccountRecord[],
    accountId?: string,
  ): Promise<AccountWithBalanceDto[]> => {
    if (accounts.length === 0) {
      return [];
    }
    const [totals, used] = await Promise.all([
      repository.movementTotals(userId, accountId),
      repository.accountsWithTransactions(userId, accountId),
    ]);
    return accounts.map((account) => ({
      account: toAccountDto(account),
      balance: describeAccountBalance(account, totals.get(account.id) ?? NO_MOVEMENTS),
      hasTransactions: used.has(account.id),
    }));
  };

  const single = async (
    caller: Caller,
    account: AccountRecord | null,
  ): Promise<AccountWithBalanceDto> => {
    if (account === null) {
      throw notFound();
    }
    const [result] = await withBalances(caller.userId, [account], account.id);
    if (result === undefined) {
      throw notFound();
    }
    return result;
  };

  return {
    list: async (caller, query) => {
      const accounts = await repository.list(caller.userId, query);
      return { accounts: await withBalances(caller.userId, accounts) };
    },

    summary: async (caller) => {
      const active = await repository.list(caller.userId, { status: 'active' });
      const entries = await withBalances(caller.userId, active);
      return summarizeBalances(
        entries.map(({ account, balance }) => ({
          currency: account.currency,
          classification: account.classification,
          currentBalanceMinor: parseMinorUnits(balance.currentBalanceMinor),
        })),
      );
    },

    get: async (caller, accountId) =>
      single(caller, await repository.findOwned(caller.userId, accountId)),

    create: async (caller, input) => {
      const at = now();
      const openingBalanceDate = input.openingBalanceDate ?? todayIn(caller.timeZone, at);
      assertNotInFuture(openingBalanceDate, caller, at);

      const account = await repository.create({
        userId: caller.userId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        openingBalanceMinor: parseMinorUnits(input.openingBalanceMinor),
        openingBalanceDate: fromIsoDate(openingBalanceDate),
        institution: input.institution ?? null,
        creditLimitMinor:
          input.creditLimitMinor === undefined ? null : parseMinorUnits(input.creditLimitMinor),
        color: input.color ?? null,
        createdAt: at,
      });
      return single(caller, account);
    },

    update: async (caller, accountId, input) => {
      const at = now();
      const updated = await repository.update(caller.userId, accountId, (current, used) =>
        planAccountUpdate(current, used, input, caller, at),
      );
      return single(caller, updated);
    },

    archive: async (caller, accountId) =>
      single(caller, await repository.setArchived(caller.userId, accountId, now())),

    restore: async (caller, accountId) =>
      single(caller, await repository.setArchived(caller.userId, accountId, null)),
  };
}
