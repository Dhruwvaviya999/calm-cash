import { CASH_FLOW_TRANSACTION_TYPES, type TrendGranularity } from '@calmcash/shared';
import { z } from 'zod';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';

// Aggregate queries for the dashboard. Every query is scoped by the owner's user ID and computes
// its totals in PostgreSQL (`SUM` over `BIGINT` yields `NUMERIC`, returned as text and parsed to
// `bigint`), so no transaction list is ever loaded into memory to add it up.

/** A half-open interval of instants: `start` inclusive, `end` exclusive. */
export interface InstantWindow {
  start: Date;
  end: Date;
}

export interface CashFlowSums {
  incomeMinor: bigint;
  expenseMinor: bigint;
  incomeCount: number;
  expenseCount: number;
}

export interface TrendRow {
  /** First calendar day of the bucket in the user's time zone (`YYYY-MM-DD`). */
  bucket: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
}

export interface CategoryRow {
  /** Top-level category; null for expenses without a category. */
  categoryId: string | null;
  name: string | null;
  archived: boolean;
  totalMinor: bigint;
  count: number;
}

export interface AccountCurrencies {
  /** Distinct currencies of the user's accounts, any status. */
  currencies: string[];
  active: number;
  archived: number;
}

export interface DashboardRepository {
  accountCurrencies: (userId: string) => Promise<AccountCurrencies>;
  /** Whether any non-voided transaction exists for the user, in any currency. */
  hasTransactions: (userId: string) => Promise<boolean>;
  /** Cash-flow sums for each window, in one query (one consistent snapshot). */
  cashFlowTotals: (
    userId: string,
    currency: string,
    windows: readonly InstantWindow[],
  ) => Promise<CashFlowSums[]>;
  /** Cash-flow sums per calendar bucket in the user's time zone; empty buckets are absent. */
  cashFlowTrend: (
    userId: string,
    currency: string,
    window: InstantWindow,
    granularity: TrendGranularity,
    timeZone: string,
  ) => Promise<TrendRow[]>;
  /** Expense sums per top-level category (subcategories rolled up into their parent). */
  expensesByCategory: (
    userId: string,
    currency: string,
    window: InstantWindow,
  ) => Promise<CategoryRow[]>;
}

/**
 * What counts as cash flow, in one place: the owner's active (not voided) income and expense
 * transactions in one currency, with `occurred_at` in the window. Transfers and balance
 * adjustments are excluded by the shared `CASH_FLOW_TRANSACTION_TYPES`, the same definition the
 * Phase 5 transaction summary uses.
 */
export function cashFlowScope(userId: string, currency: string, window: InstantWindow): Prisma.Sql {
  return Prisma.sql`t.user_id = ${userId}::uuid
    AND t.currency = ${currency}
    AND t.voided_at IS NULL
    AND t.type::text IN (${Prisma.join([...CASH_FLOW_TRANSACTION_TYPES])})
    AND t.occurred_at >= ${window.start}
    AND t.occurred_at < ${window.end}`;
}

const digits = z.string().regex(/^\d+$/);

const totalsRowSchema = z.object({
  window: z.number().int().nonnegative(),
  type: z.enum(CASH_FLOW_TRANSACTION_TYPES),
  total: digits,
  count: z.number().int().nonnegative(),
});

const trendRowSchema = z.object({ bucket: z.iso.date(), income: digits, expense: digits });

const categoryRowSchema = z.object({
  categoryId: z.string().nullable(),
  name: z.string().nullable(),
  archived: z.boolean(),
  total: digits,
  count: z.number().int().positive(),
});

const currencyRowSchema = z.object({
  currency: z.string(),
  active: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});

const existsRowSchema = z.object({ exists: z.boolean() });

export function createPrismaDashboardRepository(prisma: PrismaClient): DashboardRepository {
  return {
    accountCurrencies: async (userId) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT currency,
               COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS "active",
               COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS "archived"
        FROM accounts
        WHERE user_id = ${userId}::uuid
        GROUP BY currency
        ORDER BY currency`;
      const parsed = z.array(currencyRowSchema).parse(rows);
      return {
        currencies: parsed.map((row) => row.currency),
        active: parsed.reduce((sum, row) => sum + row.active, 0),
        archived: parsed.reduce((sum, row) => sum + row.archived, 0),
      };
    },

    hasTransactions: async (userId) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT EXISTS (
          SELECT 1 FROM transactions WHERE user_id = ${userId}::uuid AND voided_at IS NULL
        ) AS "exists"`;
      return z.array(existsRowSchema).parse(rows)[0]?.exists ?? false;
    },

    cashFlowTotals: async (userId, currency, windows) => {
      if (windows.length === 0) {
        return [];
      }
      const values = Prisma.join(
        windows.map(
          (window, index) =>
            Prisma.sql`(${index}::int, ${window.start}::timestamptz, ${window.end}::timestamptz)`,
        ),
      );
      const outer: InstantWindow = {
        start: new Date(Math.min(...windows.map((window) => window.start.getTime()))),
        end: new Date(Math.max(...windows.map((window) => window.end.getTime()))),
      };
      const rows: unknown = await prisma.$queryRaw`
        SELECT w.idx AS "window", t.type::text AS "type",
               SUM(t.amount_minor)::text AS "total", COUNT(*)::int AS "count"
        FROM transactions t
        JOIN (VALUES ${values}) AS w(idx, start_at, end_at)
          ON t.occurred_at >= w.start_at AND t.occurred_at < w.end_at
        WHERE ${cashFlowScope(userId, currency, outer)}
        GROUP BY w.idx, t.type`;
      const sums: CashFlowSums[] = windows.map(() => ({
        incomeMinor: 0n,
        expenseMinor: 0n,
        incomeCount: 0,
        expenseCount: 0,
      }));
      for (const row of z.array(totalsRowSchema).parse(rows)) {
        const target = sums[row.window];
        if (target === undefined) continue;
        if (row.type === 'income') {
          target.incomeMinor = BigInt(row.total);
          target.incomeCount = row.count;
        } else {
          target.expenseMinor = BigInt(row.total);
          target.expenseCount = row.count;
        }
      }
      return sums;
    },

    cashFlowTrend: async (userId, currency, window, granularity, timeZone) => {
      // `date_trunc` on the local wall-clock time puts each transaction in the user's calendar
      // bucket (weeks start on Monday). The unit comes from a fixed list, bound as a parameter.
      const rows: unknown = await prisma.$queryRaw`
        SELECT to_char(date_trunc(${granularity}, t.occurred_at AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS "bucket",
               COALESCE(SUM(t.amount_minor) FILTER (WHERE t.type = 'income'), 0)::text AS "income",
               COALESCE(SUM(t.amount_minor) FILTER (WHERE t.type = 'expense'), 0)::text AS "expense"
        FROM transactions t
        WHERE ${cashFlowScope(userId, currency, window)}
        GROUP BY 1
        ORDER BY 1`;
      return z
        .array(trendRowSchema)
        .parse(rows)
        .map((row) => ({
          bucket: row.bucket,
          incomeMinor: BigInt(row.income),
          expenseMinor: BigInt(row.expense),
        }));
    },

    expensesByCategory: async (userId, currency, window) => {
      // A category of another user can never be joined: the join repeats the owner check.
      const rows: unknown = await prisma.$queryRaw`
        SELECT COALESCE(c.parent_id, c.id)::text AS "categoryId",
               COALESCE(p.name, c.name) AS "name",
               (COALESCE(p.archived_at, c.archived_at) IS NOT NULL) AS "archived",
               SUM(t.amount_minor)::text AS "total",
               COUNT(*)::int AS "count"
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
        LEFT JOIN categories p ON p.id = c.parent_id AND p.user_id = t.user_id
        WHERE ${cashFlowScope(userId, currency, window)} AND t.type = 'expense'
        GROUP BY 1, 2, 3`;
      return z
        .array(categoryRowSchema)
        .parse(rows)
        .map((row) => ({
          categoryId: row.categoryId,
          name: row.name,
          archived: row.archived,
          totalMinor: BigInt(row.total),
          count: row.count,
        }));
    },
  };
}
