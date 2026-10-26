import type {
  AccountColor,
  AccountStatusFilter,
  AccountType,
  CurrencyCode,
} from '@calmcash/shared';
import { z } from 'zod';

import { Prisma, type Account, type PrismaClient } from '../../generated/prisma/client';
import { calculateCurrentBalance, NO_MOVEMENTS, type MovementTotals } from './account-balance';
import { lockAccounts, queryMovementTotals } from './account-ledger';

// Database access for accounts. Every query is scoped by the owner's user ID; an account ID alone
// never identifies a row.

export type AccountRecord = Account;

export interface AccountFilters {
  status: AccountStatusFilter;
  type?: AccountType | undefined;
}

export interface NewAccount {
  userId: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  openingBalanceMinor: bigint;
  /** UTC midnight of the calendar date. */
  openingBalanceDate: Date;
  institution: string | null;
  creditLimitMinor: bigint | null;
  color: AccountColor | null;
  createdAt: Date;
}

export interface AccountChanges {
  name?: string;
  type?: AccountType;
  currency?: CurrencyCode;
  openingBalanceMinor?: bigint;
  openingBalanceDate?: Date;
  institution?: string | null;
  creditLimitMinor?: bigint | null;
  color?: AccountColor | null;
}

/** What an update decision needs to know about the locked account besides the row itself. */
export interface LockedAccountState {
  /** True once any transaction (including a voided one) uses the account. */
  hasTransactions: boolean;
  /** The current signed balance, from the authoritative balance calculation. */
  currentBalanceMinor: bigint;
}

/** Decides the changes for a locked account; may throw to abort the update. */
export type UpdatePlanner = (current: AccountRecord, state: LockedAccountState) => AccountChanges;

export interface AccountsRepository {
  list: (userId: string, filters: AccountFilters) => Promise<AccountRecord[]>;
  findOwned: (userId: string, accountId: string) => Promise<AccountRecord | null>;
  create: (account: NewAccount) => Promise<AccountRecord>;
  /**
   * Locks the account row (`FOR UPDATE`), lets `plan` decide the changes with the current state,
   * whether any transaction uses the account, and its current balance, and applies them in the
   * same transaction. Null when the user owns no such account.
   */
  update: (userId: string, accountId: string, plan: UpdatePlanner) => Promise<AccountRecord | null>;
  /** Sets or clears `archived_at` if it is not already in that state; null when not owned. */
  setArchived: (
    userId: string,
    accountId: string,
    archivedAt: Date | null,
  ) => Promise<AccountRecord | null>;
  /** Movement totals per account of the user (accounts without movements are absent). */
  movementTotals: (userId: string, accountId?: string) => Promise<Map<string, MovementTotals>>;
  /** IDs of the user's accounts that any transaction uses (as source or destination). */
  accountsWithTransactions: (userId: string, accountId?: string) => Promise<Set<string>>;
}

const accountIdRowSchema = z.object({ accountId: z.string() });

function statusWhere(status: AccountStatusFilter): Prisma.AccountWhereInput {
  switch (status) {
    case 'active':
      return { archivedAt: null };
    case 'archived':
      return { archivedAt: { not: null } };
    case 'all':
      return {};
  }
}

function onlyAccount(accountId: string | undefined): Prisma.Sql {
  return accountId === undefined ? Prisma.empty : Prisma.sql`AND a.id = ${accountId}::uuid`;
}

export function createPrismaAccountsRepository(prisma: PrismaClient): AccountsRepository {
  return {
    list: (userId, filters) =>
      prisma.account.findMany({
        where: {
          userId,
          ...statusWhere(filters.status),
          ...(filters.type === undefined ? {} : { type: filters.type }),
        },
        // Documented order: active before archived, then oldest first.
        orderBy: [
          { archivedAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      }),

    findOwned: (userId, accountId) =>
      prisma.account.findFirst({ where: { id: accountId, userId } }),

    create: (account) =>
      prisma.account.create({
        data: {
          userId: account.userId,
          name: account.name,
          type: account.type,
          currency: account.currency,
          openingBalanceMinor: account.openingBalanceMinor,
          openingBalanceDate: account.openingBalanceDate,
          institution: account.institution,
          creditLimitMinor: account.creditLimitMinor,
          color: account.color,
          createdAt: account.createdAt,
        },
      }),

    update: (userId, accountId, plan) =>
      prisma.$transaction(async (tx) => {
        // The same lock every transaction write takes, so neither the "has transactions" decision
        // nor the balance can go stale before the update.
        await lockAccounts(tx, userId, [accountId]);
        const current = await tx.account.findFirst({ where: { id: accountId, userId } });
        if (current === null) {
          return null;
        }
        const used = await tx.transaction.findFirst({
          where: { OR: [{ accountId }, { transferAccountId: accountId }] },
          select: { id: true },
        });
        const totals = await queryMovementTotals(tx, userId, { accountIds: [accountId] });
        const changes = plan(current, {
          hasTransactions: used !== null,
          currentBalanceMinor: calculateCurrentBalance(
            current.openingBalanceMinor,
            totals.get(accountId) ?? NO_MOVEMENTS,
          ),
        });
        return tx.account.update({ where: { id: current.id }, data: changes });
      }),

    setArchived: async (userId, accountId, archivedAt) => {
      await prisma.account.updateMany({
        where: {
          id: accountId,
          userId,
          archivedAt: archivedAt === null ? { not: null } : null,
        },
        data: { archivedAt },
      });
      return prisma.account.findFirst({ where: { id: accountId, userId } });
    },

    movementTotals: (userId, accountId) =>
      queryMovementTotals(
        prisma,
        userId,
        accountId === undefined ? {} : { accountIds: [accountId] },
      ),

    accountsWithTransactions: async (userId, accountId) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT a.id::text AS "accountId"
        FROM accounts a
        WHERE a.user_id = ${userId}::uuid ${onlyAccount(accountId)}
          AND (
            EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id)
            OR EXISTS (SELECT 1 FROM transactions t WHERE t.transfer_account_id = a.id)
          )`;
      return new Set(
        z
          .array(accountIdRowSchema)
          .parse(rows)
          .map((row) => row.accountId),
      );
    },
  };
}
