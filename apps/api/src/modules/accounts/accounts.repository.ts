import type {
  AccountColor,
  AccountStatusFilter,
  AccountType,
  CurrencyCode,
} from '@calmcash/shared';
import { z } from 'zod';

import { Prisma, type Account, type PrismaClient } from '../../generated/prisma/client';
import { NO_MOVEMENTS, type MovementTotals } from './account-balance';

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

/** Decides the changes for a locked account; may throw to abort the update. */
export type UpdatePlanner = (current: AccountRecord, hasTransactions: boolean) => AccountChanges;

export interface AccountsRepository {
  list: (userId: string, filters: AccountFilters) => Promise<AccountRecord[]>;
  findOwned: (userId: string, accountId: string) => Promise<AccountRecord | null>;
  create: (account: NewAccount) => Promise<AccountRecord>;
  /**
   * Locks the account row (`FOR UPDATE`), lets `plan` decide the changes with the current state and
   * whether any transaction uses the account, and applies them in the same transaction. Null when
   * the user owns no such account.
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

const movementRowSchema = z.object({
  accountId: z.string(),
  incomeMinor: z.string().regex(/^\d+$/),
  expenseMinor: z.string().regex(/^\d+$/),
  transfersOutMinor: z.string().regex(/^\d+$/),
  transfersInMinor: z.string().regex(/^\d+$/),
  counted: z.number().int().nonnegative(),
});

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
        // Serialises concurrent edits of the same account (and, from Phase 5, transaction writes
        // that lock it) so the "has transactions" decision cannot go stale before the update.
        await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${accountId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
        const current = await tx.account.findFirst({ where: { id: accountId, userId } });
        if (current === null) {
          return null;
        }
        const used = await tx.transaction.findFirst({
          where: { OR: [{ accountId }, { transferAccountId: accountId }] },
          select: { id: true },
        });
        const changes = plan(current, used !== null);
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

    movementTotals: async (userId, accountId) => {
      const rows: unknown = await prisma.$queryRaw`
        WITH scoped AS (
          SELECT a.id, a.user_id, a.currency,
                 (a.opening_balance_date::timestamp AT TIME ZONE u.timezone) AS counts_from
          FROM accounts a
          JOIN users u ON u.id = a.user_id
          WHERE a.user_id = ${userId}::uuid ${onlyAccount(accountId)}
        ),
        movements AS (
          SELECT s.id AS account_id, t.type::text AS kind, t.amount_minor
          FROM scoped s
          JOIN transactions t ON t.account_id = s.id
          WHERE t.user_id = s.user_id AND t.currency = s.currency AND t.occurred_at >= s.counts_from
          UNION ALL
          SELECT s.id, 'transfer_in', t.amount_minor
          FROM scoped s
          JOIN transactions t ON t.transfer_account_id = s.id
          WHERE t.type = 'transfer' AND t.user_id = s.user_id AND t.currency = s.currency
            AND t.occurred_at >= s.counts_from
        )
        SELECT account_id::text AS "accountId",
               COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'income'), 0)::text AS "incomeMinor",
               COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'expense'), 0)::text AS "expenseMinor",
               COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'transfer'), 0)::text AS "transfersOutMinor",
               COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'transfer_in'), 0)::text AS "transfersInMinor",
               COUNT(*)::int AS "counted"
        FROM movements
        GROUP BY account_id`;

      const totals = new Map<string, MovementTotals>();
      for (const row of z.array(movementRowSchema).parse(rows)) {
        totals.set(row.accountId, {
          ...NO_MOVEMENTS,
          incomeMinor: BigInt(row.incomeMinor),
          expenseMinor: BigInt(row.expenseMinor),
          transfersOutMinor: BigInt(row.transfersOutMinor),
          transfersInMinor: BigInt(row.transfersInMinor),
          counted: row.counted,
        });
      }
      return totals;
    },

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
