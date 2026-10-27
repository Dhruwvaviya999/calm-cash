import {
  GOAL_CONTRIBUTION_HISTORY_LIMIT,
  MAX_SAVINGS_GOALS,
  type SavingsGoalStatusFilter,
} from '@calmcash/shared';
import { z } from 'zod';

import type { Prisma } from '../../generated/prisma/client';
import type { GoalContribution, PrismaClient, SavingsGoal } from '../../generated/prisma/client';

// Database access for savings goals and their contributions. Every query is scoped by the owner's
// user ID. A goal's tracked amount is never stored: it is the sum of its contributions, which are
// planning allocations and touch no account or transaction.

export type GoalRecord = SavingsGoal;
export type ContributionRecord = GoalContribution;

export interface SavedTotal {
  savedMinor: bigint;
  count: number;
}

export interface GoalWrite {
  name: string;
  description: string | null;
  targetMinor: bigint;
  currency: string;
  targetDate: Date | null;
}

export interface GoalStateChange {
  pausedAt?: Date | null;
  completedAt?: Date | null;
  archivedAt?: Date | null;
}

export interface NewContribution {
  amountMinor: bigint;
  contributedOn: Date;
  note: string | null;
  createdAt: Date;
}

/** Operations on one locked goal, inside a database transaction. */
export interface GoalStore {
  /** Locks the user's goal (`SELECT … FOR UPDATE`); null when it is not theirs. */
  lock: (userId: string, goalId: string) => Promise<GoalRecord | null>;
  saved: (goalId: string) => Promise<SavedTotal>;
  create: (userId: string, write: GoalWrite, createdAt: Date) => Promise<GoalRecord>;
  update: (goalId: string, change: Partial<GoalWrite> & GoalStateChange) => Promise<void>;
  addContribution: (userId: string, goalId: string, contribution: NewContribution) => Promise<void>;
}

export interface GoalsRepository {
  list: (userId: string, status: SavingsGoalStatusFilter) => Promise<GoalRecord[]>;
  find: (userId: string, goalId: string) => Promise<GoalRecord | null>;
  /** Tracked totals per goal, from one grouped query. */
  savedTotals: (userId: string, goalIds: readonly string[]) => Promise<Map<string, SavedTotal>>;
  /** Newest first, up to the history limit. */
  contributions: (userId: string, goalId: string) => Promise<ContributionRecord[]>;
  inGoalWrite: <T>(work: (store: GoalStore) => Promise<T>) => Promise<T>;
}

const idRowSchema = z.object({ id: z.string() });

function statusWhere(status: SavingsGoalStatusFilter): Prisma.SavingsGoalWhereInput {
  switch (status) {
    case 'current':
      return { archivedAt: null };
    case 'archived':
      return { archivedAt: { not: null } };
    case 'all':
      return {};
  }
}

function createStore(tx: Prisma.TransactionClient): GoalStore {
  return {
    lock: async (userId, goalId) => {
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM savings_goals
        WHERE user_id = ${userId}::uuid AND id = ${goalId}::uuid
        FOR UPDATE`;
      const [row] = z.array(idRowSchema).parse(rows);
      return row === undefined ? null : tx.savingsGoal.findUnique({ where: { id: row.id } });
    },

    saved: async (goalId) => {
      const result = await tx.goalContribution.aggregate({
        where: { goalId },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });
      return { savedMinor: result._sum.amountMinor ?? 0n, count: result._count._all };
    },

    create: (userId, write, createdAt) =>
      tx.savingsGoal.create({ data: { ...write, userId, createdAt } }),

    update: async (goalId, change) => {
      await tx.savingsGoal.update({ where: { id: goalId }, data: change });
    },

    addContribution: async (userId, goalId, contribution) => {
      await tx.goalContribution.create({ data: { ...contribution, userId, goalId } });
    },
  };
}

export function createPrismaGoalsRepository(prisma: PrismaClient): GoalsRepository {
  return {
    list: (userId, status) =>
      prisma.savingsGoal.findMany({
        where: { userId, ...statusWhere(status) },
        orderBy: [
          { completedAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: MAX_SAVINGS_GOALS,
      }),

    find: (userId, goalId) => prisma.savingsGoal.findFirst({ where: { id: goalId, userId } }),

    savedTotals: async (userId, goalIds) => {
      if (goalIds.length === 0) {
        return new Map();
      }
      const groups = await prisma.goalContribution.groupBy({
        by: ['goalId'],
        where: { userId, goalId: { in: [...goalIds] } },
        _sum: { amountMinor: true },
        _count: { _all: true },
      });
      return new Map(
        groups.map((group) => [
          group.goalId,
          { savedMinor: group._sum.amountMinor ?? 0n, count: group._count._all },
        ]),
      );
    },

    contributions: (userId, goalId) =>
      prisma.goalContribution.findMany({
        where: { userId, goalId },
        orderBy: [{ contributedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: GOAL_CONTRIBUTION_HISTORY_LIMIT,
      }),

    inGoalWrite: (work) => prisma.$transaction((tx) => work(createStore(tx))),
  };
}
