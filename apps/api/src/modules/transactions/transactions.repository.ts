import type {
  AdjustmentDirection,
  CashFlowTransactionType,
  CurrencyCode,
  PaymentMethod,
  TransactionFilterQuery,
  TransactionSort,
  TransactionType,
} from '@calmcash/shared';
import { z } from 'zod';

import {
  Prisma,
  type Account,
  type Category,
  type PrismaClient,
  type Transaction,
} from '../../generated/prisma/client';
import { recordBudgetsChanged } from '../../lib/automation-events';
import {
  lockAccounts,
  queryMovementTotals,
  readCountsFrom,
  type MovementQuery,
  type MovementTotals,
} from '../accounts';
import { transactionOrderBy, transactionWhere } from './transaction-query';

// Database access for transactions. Every query is scoped by the owner's user ID. Writes run in a
// `Ledger`: one database transaction that locks what it changes (transaction rows first, then
// accounts in ID order), so concurrent writes queue instead of interleaving. A ledger that changed
// spending also records a budget re-check for the worker in the same transaction, so no committed
// change can miss its budget alerts (see lib/automation-events.ts).

export type TransactionRecord = Transaction;

/** Columns a write sets; the owner, ID, timestamps, and void state are handled separately. */
export interface TransactionWrite {
  type: TransactionType;
  accountId: string;
  transferAccountId: string | null;
  amountMinor: bigint;
  currency: CurrencyCode;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  paymentMethod: PaymentMethod | null;
  adjustmentDirection: AdjustmentDirection | null;
  notes: string | null;
  tags: string[];
  occurredAt: Date;
}

/** A locked account and the first instant whose transactions count toward its balance. */
export interface LockedAccount {
  record: Account;
  countsFrom: Date;
}

export type CategoryRecord = Category;

const refsInclude = {
  account: true,
  transferAccount: true,
  category: { include: { parent: { select: { name: true } } } },
} satisfies Prisma.TransactionInclude;

/** A transaction with the account(s) and category a view shows next to it. */
export type TransactionWithRefs = Prisma.TransactionGetPayload<{ include: typeof refsInclude }>;

export interface CashFlowGroup {
  currency: string;
  type: CashFlowTransactionType;
  totalMinor: bigint;
  count: number;
}

export interface TransactionPageQuery {
  filters: TransactionFilterQuery;
  timeZone: string;
  sort: TransactionSort;
  page: number;
  pageSize: number;
}

/** Thrown when an insert reuses an idempotency key; the transaction has been rolled back. */
export class IdempotencyKeyTakenError extends Error {
  override readonly name = 'IdempotencyKeyTakenError';
}

/**
 * The database client of a ledger's transaction, handed to another module that must change its
 * own rows atomically with a transaction write (confirming a scheduled occurrence).
 */
export type LinkedWriteClient = Prisma.TransactionClient;

/** Operations available inside one atomic write. */
export interface Ledger {
  /** The same database transaction, for linked writes of other modules. */
  client: LinkedWriteClient;
  findByIdempotencyKey: (userId: string, key: string) => Promise<TransactionRecord | null>;
  /** Locks the user's transactions with these IDs (ID order) and returns them; others are absent. */
  lockTransactions: (
    userId: string,
    transactionIds: readonly string[],
  ) => Promise<TransactionRecord[]>;
  /** Locks the user's accounts with these IDs (ID order); accounts the user does not own are absent. */
  lockAccounts: (
    userId: string,
    accountIds: readonly string[],
  ) => Promise<Map<string, LockedAccount>>;
  findCategory: (userId: string, categoryId: string) => Promise<CategoryRecord | null>;
  movementTotals: (userId: string, query: MovementQuery) => Promise<Map<string, MovementTotals>>;
  insert: (
    userId: string,
    write: TransactionWrite,
    idempotencyKey: string | null,
    createdAt: Date,
  ) => Promise<TransactionRecord>;
  update: (transactionId: string, write: TransactionWrite) => Promise<void>;
  setVoided: (
    transactionIds: readonly string[],
    voided: { at: Date; reason: string | null } | null,
  ) => Promise<number>;
  setCategory: (transactionIds: readonly string[], categoryId: string) => Promise<number>;
  setTags: (transactionId: string, tags: readonly string[]) => Promise<void>;
}

export interface TransactionsRepository {
  /** Runs `work` in one database transaction; anything it throws rolls everything back. */
  inLedger: <T>(work: (ledger: Ledger) => Promise<T>) => Promise<T>;
  findWithRefs: (userId: string, transactionId: string) => Promise<TransactionWithRefs | null>;
  findByIdempotencyKey: (userId: string, key: string) => Promise<TransactionRecord | null>;
  findPage: (
    userId: string,
    query: TransactionPageQuery,
  ) => Promise<{ rows: TransactionWithRefs[]; total: number }>;
  /** Income and expense totals per currency of the active transactions matching the filters. */
  cashFlow: (
    userId: string,
    filters: TransactionFilterQuery,
    timeZone: string,
  ) => Promise<CashFlowGroup[]>;
  /** An account of the user with the first instant that counts toward its balance (no lock). */
  findAccount: (userId: string, accountId: string) => Promise<LockedAccount | null>;
  movementTotals: (userId: string, query: MovementQuery) => Promise<Map<string, MovementTotals>>;
}

const idRowSchema = z.object({ id: z.string() });

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** What a ledger changed that budgets may depend on: new rows' owners and edited row IDs. */
interface LedgerChanges {
  owners: Set<string>;
  transactionIds: Set<string>;
}

function createLedger(tx: Prisma.TransactionClient, changes: LedgerChanges): Ledger {
  return {
    client: tx,

    findByIdempotencyKey: (userId, key) =>
      tx.transaction.findFirst({ where: { userId, idempotencyKey: key } }),

    lockTransactions: async (userId, transactionIds) => {
      const unique = [...new Set(transactionIds)];
      if (unique.length === 0) {
        return [];
      }
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM transactions
        WHERE user_id = ${userId}::uuid AND id = ANY(${unique}::uuid[])
        ORDER BY id
        FOR UPDATE`;
      const locked = z
        .array(idRowSchema)
        .parse(rows)
        .map((row) => row.id);
      return locked.length === 0
        ? []
        : tx.transaction.findMany({ where: { userId, id: { in: locked } } });
    },

    lockAccounts: async (userId, accountIds) => {
      const countsFrom = await lockAccounts(tx, userId, accountIds);
      const records = await tx.account.findMany({
        where: { userId, id: { in: [...countsFrom.keys()] } },
      });
      return new Map(
        records.flatMap((record) => {
          const from = countsFrom.get(record.id);
          return from === undefined ? [] : [[record.id, { record, countsFrom: from }] as const];
        }),
      );
    },

    findCategory: (userId, categoryId) =>
      tx.category.findFirst({ where: { id: categoryId, userId } }),

    movementTotals: (userId, query) => queryMovementTotals(tx, userId, query),

    insert: async (userId, write, idempotencyKey, createdAt) => {
      try {
        const created = await tx.transaction.create({
          data: { ...write, userId, idempotencyKey, createdAt },
        });
        changes.owners.add(userId);
        return created;
      } catch (error: unknown) {
        if (idempotencyKey !== null && isUniqueViolation(error)) {
          throw new IdempotencyKeyTakenError('Idempotency key already used.', { cause: error });
        }
        throw error;
      }
    },

    update: async (transactionId, write) => {
      await tx.transaction.update({ where: { id: transactionId }, data: write });
      changes.transactionIds.add(transactionId);
    },

    setVoided: async (transactionIds, voided) => {
      for (const id of transactionIds) changes.transactionIds.add(id);
      const { count } = await tx.transaction.updateMany({
        where: {
          id: { in: [...transactionIds] },
          voidedAt: voided === null ? { not: null } : null,
        },
        data:
          voided === null
            ? { voidedAt: null, voidReason: null }
            : { voidedAt: voided.at, voidReason: voided.reason },
      });
      return count;
    },

    setCategory: async (transactionIds, categoryId) => {
      for (const id of transactionIds) changes.transactionIds.add(id);
      const { count } = await tx.transaction.updateMany({
        where: { id: { in: [...transactionIds] } },
        data: { categoryId },
      });
      return count;
    },

    setTags: async (transactionId, tags) => {
      await tx.transaction.update({ where: { id: transactionId }, data: { tags: [...tags] } });
    },
  };
}

export interface TransactionsRepositoryOptions {
  /** Clock for the recorded budget re-check events (injectable for tests). */
  now?: () => Date;
}

/** Owners of every changed row; each gets one budget re-check event. */
async function changedOwners(
  tx: Prisma.TransactionClient,
  changes: LedgerChanges,
): Promise<Set<string>> {
  const owners = new Set(changes.owners);
  if (changes.transactionIds.size > 0) {
    const rows = await tx.transaction.findMany({
      where: { id: { in: [...changes.transactionIds] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    for (const row of rows) owners.add(row.userId);
  }
  return owners;
}

export function createPrismaTransactionsRepository(
  prisma: PrismaClient,
  { now = (): Date => new Date() }: TransactionsRepositoryOptions = {},
): TransactionsRepository {
  return {
    // Writes wait for each other's row locks, so allow time to queue for a connection and a lock.
    inLedger: (work) =>
      prisma.$transaction(
        async (tx) => {
          const changes: LedgerChanges = { owners: new Set(), transactionIds: new Set() };
          const result = await work(createLedger(tx, changes));
          // Last statement before commit: the event commits with the change or not at all.
          await recordBudgetsChanged(tx, await changedOwners(tx, changes), now());
          return result;
        },
        { maxWait: 10_000, timeout: 20_000 },
      ),

    findWithRefs: (userId, transactionId) =>
      prisma.transaction.findFirst({
        where: { id: transactionId, userId },
        include: refsInclude,
      }),

    findByIdempotencyKey: (userId, key) =>
      prisma.transaction.findFirst({ where: { userId, idempotencyKey: key } }),

    findPage: async (userId, { filters, timeZone, sort, page, pageSize }) => {
      const where = transactionWhere(userId, filters, timeZone);
      // Two independent reads on separate pool connections. A batch `$transaction` added nothing
      // here (under READ COMMITTED each statement has its own snapshot anyway) and pinned both to
      // one connection, where Prisma's concurrent relation loads for `include` queue up behind
      // each other (pg's "client is already executing a query" deprecation).
      const [rows, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          include: refsInclude,
          orderBy: transactionOrderBy(sort),
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.transaction.count({ where }),
      ]);
      return { rows, total };
    },

    cashFlow: async (userId, filters, timeZone) => {
      const groups = await prisma.transaction.groupBy({
        by: ['currency', 'type'],
        where: {
          AND: [
            transactionWhere(userId, filters, timeZone),
            // Voided transactions never count, and only income and spending are cash flow.
            { voidedAt: null, type: { in: ['income', 'expense'] } },
          ],
        },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });
      return groups.flatMap((group): CashFlowGroup[] =>
        group.type === 'income' || group.type === 'expense'
          ? [
              {
                currency: group.currency,
                type: group.type,
                totalMinor: group._sum.amountMinor ?? 0n,
                count: group._count._all,
              },
            ]
          : [],
      );
    },

    findAccount: async (userId, accountId) => {
      const countsFrom = (await readCountsFrom(prisma, userId, [accountId])).get(accountId);
      const record = await prisma.account.findFirst({ where: { id: accountId, userId } });
      return record === null || countsFrom === undefined ? null : { record, countsFrom };
    },

    movementTotals: (userId, query) => queryMovementTotals(prisma, userId, query),
  };
}
