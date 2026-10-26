import { z } from 'zod';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { NO_MOVEMENTS, type MovementTotals } from './account-balance';

// The database side of balances: the one aggregate query that feeds `account-balance.ts`, and the
// row lock every write that can change a balance must hold. Both accept the application client or
// an interactive-transaction client, so a write can lock, change, and re-read balances atomically.

/** `PrismaClient` or the client of an interactive transaction (`prisma.$transaction(async (tx) =>`). */
export type LedgerClient = Pick<PrismaClient, '$queryRaw'>;

export interface MovementQuery {
  /** Only these accounts of the user (default: all of them). */
  accountIds?: readonly string[];
  /** Only transactions that occurred at or before this instant (default: all). */
  asOf?: Date;
}

const movementRowSchema = z.object({
  accountId: z.string(),
  incomeMinor: z.string().regex(/^\d+$/),
  expenseMinor: z.string().regex(/^\d+$/),
  transfersOutMinor: z.string().regex(/^\d+$/),
  transfersInMinor: z.string().regex(/^\d+$/),
  adjustmentsUpMinor: z.string().regex(/^\d+$/),
  adjustmentsDownMinor: z.string().regex(/^\d+$/),
  counted: z.number().int().nonnegative(),
});

function onlyAccounts(accountIds: readonly string[] | undefined): Prisma.Sql {
  return accountIds === undefined
    ? Prisma.empty
    : Prisma.sql`AND a.id = ANY(${[...accountIds]}::uuid[])`;
}

function upTo(asOf: Date | undefined): Prisma.Sql {
  return asOf === undefined ? Prisma.empty : Prisma.sql`AND t.occurred_at <= ${asOf}`;
}

/**
 * Movement totals per account of the user, from one aggregate query (accounts without movements
 * are absent). A transaction counts for an account when it has the same owner and currency, is not
 * voided, and occurred on or after the start of the opening-balance date in the owner's time zone.
 * `SUM` over `BIGINT` yields `NUMERIC`, returned as text and parsed to `bigint`, so nothing can
 * overflow or round.
 */
export async function queryMovementTotals(
  db: LedgerClient,
  userId: string,
  { accountIds, asOf }: MovementQuery = {},
): Promise<Map<string, MovementTotals>> {
  const rows: unknown = await db.$queryRaw`
    WITH scoped AS (
      SELECT a.id, a.user_id, a.currency,
             (a.opening_balance_date::timestamp AT TIME ZONE u.timezone) AS counts_from
      FROM accounts a
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = ${userId}::uuid ${onlyAccounts(accountIds)}
    ),
    movements AS (
      SELECT s.id AS account_id,
             CASE WHEN t.type = 'balance_adjustment'
                  THEN 'adjustment_' || t.adjustment_direction::text
                  ELSE t.type::text END AS kind,
             t.amount_minor
      FROM scoped s
      JOIN transactions t ON t.account_id = s.id
      WHERE t.user_id = s.user_id AND t.currency = s.currency AND t.voided_at IS NULL
        AND t.occurred_at >= s.counts_from ${upTo(asOf)}
      UNION ALL
      SELECT s.id, 'transfer_in', t.amount_minor
      FROM scoped s
      JOIN transactions t ON t.transfer_account_id = s.id
      WHERE t.type = 'transfer' AND t.user_id = s.user_id AND t.currency = s.currency
        AND t.voided_at IS NULL AND t.occurred_at >= s.counts_from ${upTo(asOf)}
    )
    SELECT account_id::text AS "accountId",
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'income'), 0)::text AS "incomeMinor",
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'expense'), 0)::text AS "expenseMinor",
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'transfer'), 0)::text AS "transfersOutMinor",
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'transfer_in'), 0)::text AS "transfersInMinor",
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'adjustment_increase'), 0)::text AS "adjustmentsUpMinor",
           COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'adjustment_decrease'), 0)::text AS "adjustmentsDownMinor",
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
      adjustmentsUpMinor: BigInt(row.adjustmentsUpMinor),
      adjustmentsDownMinor: BigInt(row.adjustmentsDownMinor),
      counted: row.counted,
    });
  }
  return totals;
}

const lockedRowSchema = z.object({ id: z.string(), countsFrom: z.date() });

/**
 * Locks the user's accounts with these IDs (`SELECT … FOR UPDATE`) in ascending ID order, so two
 * writes that touch the same accounts always queue in the same order and cannot deadlock. Must run
 * inside a transaction; the locks are held until it ends. Returns, per locked account, the first
 * instant whose transactions count toward its balance. IDs the user does not own are absent.
 */
export async function lockAccounts(
  db: LedgerClient,
  userId: string,
  accountIds: readonly string[],
): Promise<Map<string, Date>> {
  const unique = [...new Set(accountIds)].sort();
  if (unique.length === 0) {
    return new Map();
  }
  const rows: unknown = await db.$queryRaw`
    SELECT a.id::text AS "id",
           (a.opening_balance_date::timestamp AT TIME ZONE u.timezone) AS "countsFrom"
    FROM accounts a
    JOIN users u ON u.id = a.user_id
    WHERE a.user_id = ${userId}::uuid AND a.id = ANY(${unique}::uuid[])
    ORDER BY a.id
    FOR UPDATE OF a`;
  return new Map(
    z
      .array(lockedRowSchema)
      .parse(rows)
      .map((row) => [row.id, row.countsFrom]),
  );
}

/** Like `lockAccounts`, without taking locks: for read-only checks such as previews. */
export async function readCountsFrom(
  db: LedgerClient,
  userId: string,
  accountIds: readonly string[],
): Promise<Map<string, Date>> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows: unknown = await db.$queryRaw`
    SELECT a.id::text AS "id",
           (a.opening_balance_date::timestamp AT TIME ZONE u.timezone) AS "countsFrom"
    FROM accounts a
    JOIN users u ON u.id = a.user_id
    WHERE a.user_id = ${userId}::uuid AND a.id = ANY(${unique}::uuid[])`;
  return new Map(
    z
      .array(lockedRowSchema)
      .parse(rows)
      .map((row) => [row.id, row.countsFrom]),
  );
}
