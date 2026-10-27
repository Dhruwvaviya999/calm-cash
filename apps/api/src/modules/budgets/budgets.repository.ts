import { MAX_BUDGETS, type BudgetPeriod, type BudgetStatusFilter } from '@calmcash/shared';
import { z } from 'zod';

import type { Prisma } from '../../generated/prisma/client';
import type { Budget, PrismaClient } from '../../generated/prisma/client';

// Database access for budgets. Every query is scoped by the owner's user ID. Spending is never
// stored: it is aggregated from the transaction ledger on every read, for all requested budgets
// in one query.

export type BudgetRecord = Budget;

const categoryInclude = {
  category: { include: { parent: { select: { name: true } } } },
} satisfies Prisma.BudgetInclude;

/** A budget with its category (and the category's parent name), as views show it. */
export type BudgetWithCategory = Prisma.BudgetGetPayload<{ include: typeof categoryInclude }>;

export type CategoryRecord = Prisma.CategoryGetPayload<object>;

export interface BudgetListFilter {
  status: BudgetStatusFilter;
  period?: BudgetPeriod | undefined;
  categoryId?: string | undefined;
  currency?: string | undefined;
}

/** One budget's scope and period, as instants: `start` inclusive, `end` exclusive. */
export interface SpendingWindow {
  budgetId: string;
  /** Null for an overall budget (every expense category, and uncategorised expenses). */
  categoryId: string | null;
  currency: string;
  start: Date;
  end: Date;
}

export interface SpendingTotal {
  totalMinor: bigint;
  count: number;
}

/** Columns a create or update sets. */
export interface BudgetWrite {
  name: string;
  description: string | null;
  categoryId: string | null;
  limitMinor: bigint;
  currency: string;
  period: BudgetPeriod;
  startDate: Date;
  endDate: Date | null;
  alertThresholdsBp: number[];
}

/** Operations available while the user's budget writes are serialised. */
export interface BudgetWriteStore {
  /** Locks and returns the user's budget (`SELECT … FOR UPDATE`); null when not theirs. */
  lock: (userId: string, budgetId: string) => Promise<BudgetRecord | null>;
  /**
   * Active budgets with the same scope (category or overall), currency, and period whose dates
   * overlap `[startDate, endDate]`, other than `exceptId`.
   */
  overlapping: (
    userId: string,
    candidate: BudgetWrite,
    exceptId: string | undefined,
  ) => Promise<BudgetRecord[]>;
  create: (userId: string, write: BudgetWrite, createdAt: Date) => Promise<BudgetRecord>;
  update: (budgetId: string, write: BudgetWrite) => Promise<void>;
  setArchived: (budgetId: string, archivedAt: Date | null) => Promise<void>;
}

export interface BudgetsRepository {
  list: (userId: string, filter: BudgetListFilter) => Promise<BudgetWithCategory[]>;
  find: (userId: string, budgetId: string) => Promise<BudgetWithCategory | null>;
  findCategory: (userId: string, categoryId: string) => Promise<CategoryRecord | null>;
  /** Spending per budget window (budgets without matching expenses report zero). */
  spending: (
    userId: string,
    windows: readonly SpendingWindow[],
  ) => Promise<Map<string, SpendingTotal>>;
  /**
   * Runs `work` in one database transaction holding a per-user advisory lock, so two concurrent
   * creates or edits cannot both pass the overlap check.
   */
  inBudgetWrite: <T>(userId: string, work: (store: BudgetWriteStore) => Promise<T>) => Promise<T>;
}

const spendingRowSchema = z.object({
  budgetId: z.string(),
  total: z.string().regex(/^\d+$/),
  count: z.number().int().nonnegative(),
});

const idRowSchema = z.object({ id: z.string() });

function statusWhere(status: BudgetStatusFilter): Prisma.BudgetWhereInput {
  switch (status) {
    case 'active':
      return { archivedAt: null };
    case 'archived':
      return { archivedAt: { not: null } };
    case 'all':
      return {};
  }
}

function createWriteStore(tx: Prisma.TransactionClient): BudgetWriteStore {
  return {
    lock: async (userId, budgetId) => {
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM budgets
        WHERE user_id = ${userId}::uuid AND id = ${budgetId}::uuid
        FOR UPDATE`;
      const [row] = z.array(idRowSchema).parse(rows);
      return row === undefined ? null : tx.budget.findUnique({ where: { id: row.id } });
    },

    overlapping: (userId, candidate, exceptId) =>
      tx.budget.findMany({
        where: {
          userId,
          archivedAt: null,
          categoryId: candidate.categoryId,
          currency: candidate.currency,
          period: candidate.period,
          ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
          // [a, b] and [c, d] overlap when a ≤ d and c ≤ b (an open end is +∞).
          ...(candidate.endDate === null ? {} : { startDate: { lte: candidate.endDate } }),
          OR: [{ endDate: null }, { endDate: { gte: candidate.startDate } }],
        },
      }),

    create: (userId, write, createdAt) =>
      tx.budget.create({ data: { ...write, userId, createdAt } }),

    update: async (budgetId, write) => {
      await tx.budget.update({ where: { id: budgetId }, data: write });
    },

    setArchived: async (budgetId, archivedAt) => {
      await tx.budget.update({ where: { id: budgetId }, data: { archivedAt } });
    },
  };
}

export function createPrismaBudgetsRepository(prisma: PrismaClient): BudgetsRepository {
  return {
    list: (userId, { status, period, categoryId, currency }) =>
      prisma.budget.findMany({
        where: {
          userId,
          ...statusWhere(status),
          ...(period === undefined ? {} : { period }),
          ...(categoryId === undefined ? {} : { categoryId }),
          ...(currency === undefined ? {} : { currency }),
        },
        include: categoryInclude,
        orderBy: [
          { archivedAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: MAX_BUDGETS,
      }),

    find: (userId, budgetId) =>
      prisma.budget.findFirst({ where: { id: budgetId, userId }, include: categoryInclude }),

    findCategory: (userId, categoryId) =>
      prisma.category.findFirst({ where: { id: categoryId, userId } }),

    spending: async (userId, windows) => {
      if (windows.length === 0) {
        return new Map();
      }
      // One row per budget window, joined to the expenses it counts. What counts mirrors the
      // dashboard's cash-flow definition: the owner's rows, one currency, not voided, and only
      // the `expense` type (transfers, balance adjustments, and income never count), with
      // `occurred_at` in the half-open window. A category budget counts its category and its
      // subcategories; each expense has one category, so it is counted once per budget.
      // Category IDs travel as text ('' for overall budgets) so the array has no NULL elements.
      const rows: unknown = await prisma.$queryRaw`
        SELECT w.budget_id::text AS "budgetId",
               COALESCE(SUM(t.amount_minor), 0)::text AS "total",
               COUNT(t.id)::int AS "count"
        FROM unnest(
               ${windows.map((window) => window.budgetId)}::uuid[],
               ${windows.map((window) => window.categoryId ?? '')}::text[],
               ${windows.map((window) => window.currency)}::text[],
               ${windows.map((window) => window.start.toISOString())}::timestamptz[],
               ${windows.map((window) => window.end.toISOString())}::timestamptz[]
             ) AS w(budget_id, category_id, currency, start_at, end_at)
        LEFT JOIN transactions t
          ON t.user_id = ${userId}::uuid
         AND t.type = 'expense'
         AND t.voided_at IS NULL
         AND t.currency = w.currency
         AND t.occurred_at >= w.start_at
         AND t.occurred_at < w.end_at
         AND (
           w.category_id = ''
           OR t.category_id IN (
             SELECT c.id FROM categories c
             WHERE c.user_id = ${userId}::uuid
               AND (c.id = NULLIF(w.category_id, '')::uuid
                    OR c.parent_id = NULLIF(w.category_id, '')::uuid)
           )
         )
        GROUP BY w.budget_id`;
      return new Map(
        z
          .array(spendingRowSchema)
          .parse(rows)
          .map((row) => [row.budgetId, { totalMinor: BigInt(row.total), count: row.count }]),
      );
    },

    inBudgetWrite: (userId, work) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`budgets:${userId}`}, 0))`;
        return work(createWriteStore(tx));
      }),
  };
}
