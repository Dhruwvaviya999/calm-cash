import { SCENARIO_LIMITS, type ScenarioAdjustmentDto } from '@calmcash/shared';
import { z } from 'zod';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { cashFlowScope, type InstantWindow } from '../dashboard/dashboard.repository';

// Read-only aggregates for financial intelligence, plus the two things this module stores: saved
// scenario assumptions and recommendation states. Every query is scoped by the owner's user ID and
// adds up in PostgreSQL (`SUM` over `BIGINT` returned as text, parsed to `bigint`), so transaction
// lists are never loaded into memory to be totalled. "Cash flow" is the dashboard's own definition
// (`cashFlowScope`): active income and expenses in one currency — transfers, balance adjustments,
// and voided transactions never count.

/** Totals of one calendar month (in the user's time zone), split the ways the engines need. */
export interface MonthlyCategoryRow {
  /** `YYYY-MM`. */
  month: string;
  type: 'income' | 'expense';
  /** Top-level category (subcategories rolled into their parent); null without a category. */
  categoryId: string | null;
  name: string | null;
  archived: boolean;
  /** Recorded from a recurring occurrence (already represented by the schedule going forward). */
  scheduled: boolean;
  totalMinor: bigint;
  count: number;
}

export interface DistributionRow {
  count: number;
  totalMinor: bigint;
  lowerQuartileMinor: bigint;
  medianMinor: bigint;
  upperQuartileMinor: bigint;
  ninetiethMinor: bigint;
  smallCount: number;
  smallTotalMinor: bigint;
}

export interface LargestExpenseRow {
  /** Top-level category; null for uncategorised expenses or for the overall largest. */
  categoryId: string | null;
  transactionId: string;
  occurredAt: Date;
  description: string;
  merchant: string | null;
  amountMinor: bigint;
}

export interface WeekdayRow {
  weekday: number;
  totalMinor: bigint;
  count: number;
}

export interface MerchantRow {
  key: string;
  label: string;
  totalMinor: bigint;
  count: number;
  previousTotalMinor: bigint;
  previousCount: number;
  activeMonths: number;
  mainCategoryId: string | null;
  mainCategoryName: string | null;
  mainCategoryMinor: bigint;
}

export interface GoalMonthRow {
  goalId: string;
  month: string;
  totalMinor: bigint;
  count: number;
}

export interface CategoryRef {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  parentId: string | null;
  archived: boolean;
}

export interface ScenarioRecord {
  id: string;
  userId: string;
  name: string;
  currency: string;
  horizonDays: number;
  /** Raw JSON; validated by the service on every read. */
  assumptions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScenarioWrite {
  name: string;
  currency: string;
  horizonDays: number;
  assumptions: ScenarioAdjustmentDto[];
}

export type RecommendationMark = 'dismissed' | 'reviewed';

export interface IntelligenceRepository {
  /** Distinct currencies of the user's accounts and current recurring schedules. */
  currencies: (userId: string) => Promise<string[]>;
  /** First instant with recorded income or spending in the currency (any time). */
  firstActivity: (userId: string, currency: string) => Promise<Date | null>;
  /** Income and expense totals per local month, top-level category, and scheduled origin. */
  monthlyTotals: (
    userId: string,
    currency: string,
    window: InstantWindow,
    timeZone: string,
  ) => Promise<MonthlyCategoryRow[]>;
  /** Expense amount distribution (exact `percentile_disc` values) in a window. */
  distribution: (
    userId: string,
    currency: string,
    window: InstantWindow,
  ) => Promise<DistributionRow | null>;
  /** The largest expense overall (categoryId null, first) and per top-level category. */
  largestExpenses: (
    userId: string,
    currency: string,
    window: InstantWindow,
  ) => Promise<{ overall: LargestExpenseRow | null; byCategory: LargestExpenseRow[] }>;
  weekdayTotals: (
    userId: string,
    currency: string,
    window: InstantWindow,
    timeZone: string,
  ) => Promise<WeekdayRow[]>;
  /** Merchants (grouped like the insights' payee key), current window and the one before. */
  merchants: (
    userId: string,
    currency: string,
    current: InstantWindow,
    previous: InstantWindow,
    timeZone: string,
    limit: number,
  ) => Promise<MerchantRow[]>;
  /** Net allocations per goal and calendar month from `fromDate`; plus each goal's first day. */
  goalMonths: (
    userId: string,
    goalIds: readonly string[],
    fromDate: string,
  ) => Promise<{ months: GoalMonthRow[]; first: Map<string, string> }>;
  categories: (userId: string, ids: readonly string[]) => Promise<CategoryRef[]>;
  listScenarios: (
    userId: string,
    page: number,
    pageSize: number,
  ) => Promise<{ items: ScenarioRecord[]; total: number }>;
  findScenario: (userId: string, scenarioId: string) => Promise<ScenarioRecord | null>;
  findScenarios: (userId: string, scenarioIds: readonly string[]) => Promise<ScenarioRecord[]>;
  /** Null when the person already has the maximum number of scenarios. */
  createScenario: (userId: string, write: ScenarioWrite) => Promise<ScenarioRecord | null>;
  updateScenario: (
    userId: string,
    scenarioId: string,
    write: Partial<ScenarioWrite>,
  ) => Promise<ScenarioRecord | null>;
  deleteScenario: (userId: string, scenarioId: string) => Promise<boolean>;
  recommendationMarks: (userId: string) => Promise<Map<string, Set<RecommendationMark>>>;
  markRecommendation: (userId: string, key: string, mark: RecommendationMark) => Promise<void>;
}

const digits = z.string().regex(/^\d+$/);
const signed = z.string().regex(/^-?\d+$/);

const monthlyRowSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  type: z.enum(['income', 'expense']),
  categoryId: z.string().nullable(),
  name: z.string().nullable(),
  archived: z.boolean(),
  scheduled: z.boolean(),
  total: digits,
  count: z.number().int().positive(),
});

const distributionRowSchema = z.object({
  count: z.number().int().nonnegative(),
  total: digits.nullable(),
  p25: digits.nullable(),
  p50: digits.nullable(),
  p75: digits.nullable(),
  p90: digits.nullable(),
  smallCount: z.number().int().nonnegative(),
  smallTotal: digits.nullable(),
});

const largestRowSchema = z.object({
  categoryId: z.string().nullable(),
  id: z.string(),
  occurredAt: z.date(),
  description: z.string(),
  merchant: z.string().nullable(),
  amount: digits,
});

const weekdayRowSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  total: digits,
  count: z.number().int().positive(),
});

const merchantRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  total: digits,
  count: z.number().int().nonnegative(),
  previousTotal: digits,
  previousCount: z.number().int().nonnegative(),
  activeMonths: z.number().int().nonnegative(),
  mainCategoryId: z.string().nullable(),
  mainCategoryName: z.string().nullable(),
  mainCategoryTotal: digits.nullable(),
});

const goalMonthRowSchema = z.object({
  goalId: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  total: signed,
  count: z.number().int().positive(),
});

const goalFirstRowSchema = z.object({ goalId: z.string(), first: z.iso.date() });

const currencyRowSchema = z.object({ currency: z.string() });
const firstRowSchema = z.object({ first: z.date().nullable() });

/**
 * The payee grouping key in SQL, matching `payeeKey` in `insights/merchant-key.ts`: lower case,
 * every run of non-letters a single space, the first four words; the merchant when it gives at
 * least three letters, otherwise the description.
 */
const PAYEE_KEY = Prisma.sql`(
  CASE
    WHEN length(array_to_string((regexp_split_to_array(btrim(regexp_replace(lower(COALESCE(t.merchant, '')), '[^a-z]+', ' ', 'g')), ' '))[1:4], ' ')) >= 3
      THEN left(array_to_string((regexp_split_to_array(btrim(regexp_replace(lower(t.merchant), '[^a-z]+', ' ', 'g')), ' '))[1:4], ' '), 120)
    ELSE left(array_to_string((regexp_split_to_array(btrim(regexp_replace(lower(t.description), '[^a-z]+', ' ', 'g')), ' '))[1:4], ' '), 120)
  END
)`;

function toScenarioRecord(row: {
  id: string;
  userId: string;
  name: string;
  currency: string;
  horizonDays: number;
  assumptions: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): ScenarioRecord {
  return { ...row, assumptions: row.assumptions };
}

/** Scenario assumptions as stored JSON (plain objects and strings only). */
function toJson(adjustments: readonly ScenarioAdjustmentDto[]): Prisma.InputJsonValue {
  return adjustments.map((adjustment) => ({ ...adjustment }));
}

export function createPrismaIntelligenceRepository(prisma: PrismaClient): IntelligenceRepository {
  return {
    currencies: async (userId) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT currency FROM accounts WHERE user_id = ${userId}::uuid
        UNION
        SELECT currency FROM recurring_schedules
        WHERE user_id = ${userId}::uuid AND archived_at IS NULL
        ORDER BY currency`;
      return z
        .array(currencyRowSchema)
        .parse(rows)
        .map((row) => row.currency);
    },

    firstActivity: async (userId, currency) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT MIN(t.occurred_at) AS "first"
        FROM transactions t
        WHERE t.user_id = ${userId}::uuid AND t.currency = ${currency}
          AND t.voided_at IS NULL AND t.type IN ('income', 'expense')`;
      return z.array(firstRowSchema).parse(rows)[0]?.first ?? null;
    },

    monthlyTotals: async (userId, currency, window, timeZone) => {
      // A recorded occurrence links its transaction (unique), so the join adds at most one row.
      const rows: unknown = await prisma.$queryRaw`
        SELECT to_char(date_trunc('month', t.occurred_at AT TIME ZONE ${timeZone}), 'YYYY-MM') AS "month",
               t.type::text AS "type",
               COALESCE(c.parent_id, c.id)::text AS "categoryId",
               COALESCE(p.name, c.name) AS "name",
               (COALESCE(p.archived_at, c.archived_at) IS NOT NULL) AS "archived",
               (o.id IS NOT NULL) AS "scheduled",
               SUM(t.amount_minor)::text AS "total",
               COUNT(*)::int AS "count"
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
        LEFT JOIN categories p ON p.id = c.parent_id AND p.user_id = t.user_id
        LEFT JOIN scheduled_occurrences o ON o.transaction_id = t.id AND o.user_id = t.user_id
        WHERE ${cashFlowScope(userId, currency, window)}
        GROUP BY 1, 2, 3, 4, 5, 6
        ORDER BY 1`;
      return z
        .array(monthlyRowSchema)
        .parse(rows)
        .map((row) => ({
          month: row.month,
          type: row.type,
          categoryId: row.categoryId,
          name: row.name,
          archived: row.archived,
          scheduled: row.scheduled,
          totalMinor: BigInt(row.total),
          count: row.count,
        }));
    },

    distribution: async (userId, currency, window) => {
      const rows: unknown = await prisma.$queryRaw`
        WITH e AS (
          SELECT t.amount_minor FROM transactions t
          WHERE ${cashFlowScope(userId, currency, window)} AND t.type = 'expense'
        ), q AS (
          SELECT COUNT(*)::int AS "count",
                 SUM(amount_minor)::text AS "total",
                 (percentile_disc(0.25) WITHIN GROUP (ORDER BY amount_minor))::text AS "p25",
                 (percentile_disc(0.5) WITHIN GROUP (ORDER BY amount_minor))::text AS "p50",
                 (percentile_disc(0.75) WITHIN GROUP (ORDER BY amount_minor))::text AS "p75",
                 (percentile_disc(0.9) WITHIN GROUP (ORDER BY amount_minor))::text AS "p90"
          FROM e
        )
        SELECT q.*,
               (SELECT COUNT(*)::int FROM e WHERE e.amount_minor <= q.p25::bigint) AS "smallCount",
               (SELECT SUM(e.amount_minor)::text FROM e WHERE e.amount_minor <= q.p25::bigint) AS "smallTotal"
        FROM q`;
      const row = z.array(distributionRowSchema).parse(rows)[0];
      if (row === undefined || row.count === 0) return null;
      return {
        count: row.count,
        totalMinor: BigInt(row.total ?? '0'),
        lowerQuartileMinor: BigInt(row.p25 ?? '0'),
        medianMinor: BigInt(row.p50 ?? '0'),
        upperQuartileMinor: BigInt(row.p75 ?? '0'),
        ninetiethMinor: BigInt(row.p90 ?? '0'),
        smallCount: row.smallCount,
        smallTotalMinor: BigInt(row.smallTotal ?? '0'),
      };
    },

    largestExpenses: async (userId, currency, window) => {
      const rows: unknown = await prisma.$queryRaw`
        (SELECT NULL::text AS "categoryId", t.id::text AS "id", t.occurred_at AS "occurredAt",
                t.description, t.merchant, t.amount_minor::text AS "amount", 0 AS "rank"
         FROM transactions t
         WHERE ${cashFlowScope(userId, currency, window)} AND t.type = 'expense'
         ORDER BY t.amount_minor DESC, t.occurred_at DESC, t.id DESC
         LIMIT 1)
        UNION ALL
        (SELECT DISTINCT ON (COALESCE(c.parent_id, c.id))
                COALESCE(c.parent_id, c.id)::text, t.id::text, t.occurred_at,
                t.description, t.merchant, t.amount_minor::text, 1
         FROM transactions t
         JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
         WHERE ${cashFlowScope(userId, currency, window)} AND t.type = 'expense'
         ORDER BY COALESCE(c.parent_id, c.id), t.amount_minor DESC, t.occurred_at DESC, t.id DESC)`;
      const parsed = z
        .array(largestRowSchema.extend({ rank: z.number().int() }))
        .parse(rows)
        .map((row) => ({
          rank: row.rank,
          row: {
            categoryId: row.categoryId,
            transactionId: row.id,
            occurredAt: row.occurredAt,
            description: row.description,
            merchant: row.merchant,
            amountMinor: BigInt(row.amount),
          },
        }));
      return {
        overall: parsed.find((entry) => entry.rank === 0)?.row ?? null,
        byCategory: parsed.filter((entry) => entry.rank === 1).map((entry) => entry.row),
      };
    },

    weekdayTotals: async (userId, currency, window, timeZone) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT EXTRACT(ISODOW FROM t.occurred_at AT TIME ZONE ${timeZone})::int AS "weekday",
               SUM(t.amount_minor)::text AS "total", COUNT(*)::int AS "count"
        FROM transactions t
        WHERE ${cashFlowScope(userId, currency, window)} AND t.type = 'expense'
        GROUP BY 1
        ORDER BY 1`;
      return z
        .array(weekdayRowSchema)
        .parse(rows)
        .map((row) => ({ weekday: row.weekday, totalMinor: BigInt(row.total), count: row.count }));
    },

    merchants: async (userId, currency, current, previous, timeZone, limit) => {
      const outer: InstantWindow = {
        start: previous.start < current.start ? previous.start : current.start,
        end: current.end > previous.end ? current.end : previous.end,
      };
      const rows: unknown = await prisma.$queryRaw`
        WITH keyed AS (
          SELECT ${PAYEE_KEY} AS key,
                 COALESCE(NULLIF(btrim(t.merchant), ''), t.description) AS label,
                 t.amount_minor, t.occurred_at,
                 (t.occurred_at >= ${current.start} AND t.occurred_at < ${current.end}) AS current,
                 (t.occurred_at >= ${previous.start} AND t.occurred_at < ${previous.end}) AS previous,
                 to_char(date_trunc('month', t.occurred_at AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month,
                 COALESCE(c.parent_id, c.id) AS category_id,
                 COALESCE(p.name, c.name) AS category_name
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
          LEFT JOIN categories p ON p.id = c.parent_id AND p.user_id = t.user_id
          WHERE ${cashFlowScope(userId, currency, outer)} AND t.type = 'expense'
        ), grouped AS (
          SELECT key,
                 (array_agg(label ORDER BY occurred_at DESC) FILTER (WHERE current))[1] AS label,
                 COALESCE(SUM(amount_minor) FILTER (WHERE current), 0) AS total,
                 COUNT(*) FILTER (WHERE current)::int AS count,
                 COALESCE(SUM(amount_minor) FILTER (WHERE previous), 0) AS previous_total,
                 COUNT(*) FILTER (WHERE previous)::int AS previous_count,
                 COUNT(DISTINCT month) FILTER (WHERE current)::int AS active_months
          FROM keyed
          WHERE length(key) >= 3
          GROUP BY key
          HAVING COUNT(*) FILTER (WHERE current) > 0
        ), ranked AS (
          SELECT *,
                 ROW_NUMBER() OVER (ORDER BY total DESC, key) AS by_total,
                 ROW_NUMBER() OVER (ORDER BY count DESC, total DESC, key) AS by_count
          FROM grouped
        ), main AS (
          SELECT DISTINCT ON (key) key, category_id, category_name, SUM(amount_minor) AS category_total
          FROM keyed
          WHERE current AND length(key) >= 3
          GROUP BY key, category_id, category_name
          ORDER BY key, SUM(amount_minor) DESC, category_name
        )
        SELECT r.key, r.label, r.total::text AS "total", r.count,
               r.previous_total::text AS "previousTotal", r.previous_count AS "previousCount",
               r.active_months AS "activeMonths",
               m.category_id::text AS "mainCategoryId", m.category_name AS "mainCategoryName",
               m.category_total::text AS "mainCategoryTotal"
        FROM ranked r
        LEFT JOIN main m ON m.key = r.key
        WHERE r.by_total <= ${limit} OR r.by_count <= ${limit}
        ORDER BY r.by_total`;
      return z
        .array(merchantRowSchema)
        .parse(rows)
        .map((row) => ({
          key: row.key,
          label: row.label,
          totalMinor: BigInt(row.total),
          count: row.count,
          previousTotalMinor: BigInt(row.previousTotal),
          previousCount: row.previousCount,
          activeMonths: row.activeMonths,
          mainCategoryId: row.mainCategoryId,
          mainCategoryName: row.mainCategoryName,
          mainCategoryMinor: BigInt(row.mainCategoryTotal ?? '0'),
        }));
    },

    goalMonths: async (userId, goalIds, fromDate) => {
      if (goalIds.length === 0) return { months: [], first: new Map() };
      const ids = Prisma.join(goalIds.map((id) => Prisma.sql`${id}::uuid`));
      const [monthRows, firstRows] = await Promise.all([
        prisma.$queryRaw`
          SELECT goal_id::text AS "goalId", to_char(contributed_on, 'YYYY-MM') AS "month",
                 SUM(amount_minor)::text AS "total", COUNT(*)::int AS "count"
          FROM goal_contributions
          WHERE user_id = ${userId}::uuid AND goal_id IN (${ids}) AND contributed_on >= ${fromDate}::date
          GROUP BY 1, 2
          ORDER BY 1, 2`,
        prisma.$queryRaw`
          SELECT goal_id::text AS "goalId", to_char(MIN(contributed_on), 'YYYY-MM-DD') AS "first"
          FROM goal_contributions
          WHERE user_id = ${userId}::uuid AND goal_id IN (${ids})
          GROUP BY 1`,
      ]);
      return {
        months: z
          .array(goalMonthRowSchema)
          .parse(monthRows)
          .map((row) => ({
            goalId: row.goalId,
            month: row.month,
            totalMinor: BigInt(row.total),
            count: row.count,
          })),
        first: new Map(
          z
            .array(goalFirstRowSchema)
            .parse(firstRows)
            .map((row) => [row.goalId, row.first]),
        ),
      };
    },

    categories: async (userId, ids) => {
      if (ids.length === 0) return [];
      const rows = await prisma.category.findMany({
        where: { userId, id: { in: [...ids] } },
        select: { id: true, name: true, kind: true, parentId: true, archivedAt: true },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        parentId: row.parentId,
        archived: row.archivedAt !== null,
      }));
    },

    listScenarios: async (userId, page, pageSize) => {
      const [rows, total] = await Promise.all([
        prisma.financialScenario.findMany({
          where: { userId },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.financialScenario.count({ where: { userId } }),
      ]);
      return { items: rows.map(toScenarioRecord), total };
    },

    findScenario: async (userId, scenarioId) => {
      const row = await prisma.financialScenario.findFirst({ where: { id: scenarioId, userId } });
      return row === null ? null : toScenarioRecord(row);
    },

    findScenarios: async (userId, scenarioIds) => {
      const rows = await prisma.financialScenario.findMany({
        where: { userId, id: { in: [...scenarioIds] } },
      });
      return rows.map(toScenarioRecord);
    },

    createScenario: (userId, write) =>
      // The per-user limit is checked and the row inserted under one advisory lock, so two
      // concurrent saves cannot both pass the count.
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('financial_scenarios'), hashtext(${userId}))`;
        if (
          (await tx.financialScenario.count({ where: { userId } })) >= SCENARIO_LIMITS.scenarios
        ) {
          return null;
        }
        const row = await tx.financialScenario.create({
          data: {
            userId,
            name: write.name,
            currency: write.currency,
            horizonDays: write.horizonDays,
            assumptions: toJson(write.assumptions),
          },
        });
        return toScenarioRecord(row);
      }),

    updateScenario: async (userId, scenarioId, write) => {
      const { count } = await prisma.financialScenario.updateMany({
        where: { id: scenarioId, userId },
        data: {
          ...(write.name === undefined ? {} : { name: write.name }),
          ...(write.currency === undefined ? {} : { currency: write.currency }),
          ...(write.horizonDays === undefined ? {} : { horizonDays: write.horizonDays }),
          ...(write.assumptions === undefined ? {} : { assumptions: toJson(write.assumptions) }),
        },
      });
      if (count === 0) return null;
      const row = await prisma.financialScenario.findFirst({ where: { id: scenarioId, userId } });
      return row === null ? null : toScenarioRecord(row);
    },

    deleteScenario: async (userId, scenarioId) => {
      const { count } = await prisma.financialScenario.deleteMany({
        where: { id: scenarioId, userId },
      });
      return count > 0;
    },

    recommendationMarks: async (userId) => {
      const rows = await prisma.aiDismissal.findMany({
        where: { userId, kind: 'recommendation' },
        select: { subjectKey: true, value: true },
      });
      const marks = new Map<string, Set<RecommendationMark>>();
      for (const row of rows) {
        if (row.value !== 'dismissed' && row.value !== 'reviewed') continue;
        const set = marks.get(row.subjectKey) ?? new Set<RecommendationMark>();
        set.add(row.value);
        marks.set(row.subjectKey, set);
      }
      return marks;
    },

    markRecommendation: async (userId, key, mark) => {
      await prisma.aiDismissal.createMany({
        data: [{ userId, kind: 'recommendation', subjectKey: key, value: mark }],
        skipDuplicates: true,
      });
    },
  };
}
