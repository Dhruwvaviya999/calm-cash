import type { AiDismissalKind } from '@calmcash/shared';

import type { PrismaClient } from '../../generated/prisma/client';

// Read-only access for the deterministic insights: the owner's active income and expenses in a
// window (transfers, balance adjustments, and voided rows never count, exactly as in the
// dashboard), current recurring schedules for de-duplication, and dismissals.

export interface ActivityRow {
  id: string;
  type: 'income' | 'expense';
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** The category's top-level parent name (or its own name when top-level). */
  topCategoryName: string | null;
  accountId: string;
  paymentMethod: string | null;
}

export interface ScheduleRef {
  name: string;
  merchant: string | null;
  currency: string;
}

export interface InsightsRepository {
  /** Active income and expenses with `start <= occurred_at < end`, newest last (bounded). */
  activity: (userId: string, start: Date, end: Date, limit: number) => Promise<ActivityRow[]>;
  schedules: (userId: string) => Promise<ScheduleRef[]>;
  dismissed: (userId: string, kind: AiDismissalKind) => Promise<Set<string>>;
  dismiss: (
    userId: string,
    kind: AiDismissalKind,
    subjectKey: string,
    value?: string,
  ) => Promise<void>;
}

export function createPrismaInsightsRepository(prisma: PrismaClient): InsightsRepository {
  return {
    activity: async (userId, start, end, limit) => {
      const rows = await prisma.transaction.findMany({
        where: {
          userId,
          voidedAt: null,
          type: { in: ['income', 'expense'] },
          occurredAt: { gte: start, lt: end },
        },
        select: {
          id: true,
          type: true,
          amountMinor: true,
          currency: true,
          occurredAt: true,
          description: true,
          merchant: true,
          categoryId: true,
          accountId: true,
          paymentMethod: true,
          category: { select: { name: true, parent: { select: { name: true } } } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.reverse().flatMap((row): ActivityRow[] =>
        row.type === 'income' || row.type === 'expense'
          ? [
              {
                id: row.id,
                type: row.type,
                amountMinor: row.amountMinor,
                currency: row.currency,
                occurredAt: row.occurredAt,
                description: row.description,
                merchant: row.merchant,
                categoryId: row.categoryId,
                categoryName: row.category?.name ?? null,
                topCategoryName: row.category?.parent?.name ?? row.category?.name ?? null,
                accountId: row.accountId,
                paymentMethod: row.paymentMethod,
              },
            ]
          : [],
      );
    },

    schedules: (userId) =>
      prisma.recurringSchedule.findMany({
        where: { userId, archivedAt: null },
        select: { name: true, merchant: true, currency: true },
      }),

    dismissed: async (userId, kind) => {
      const rows = await prisma.aiDismissal.findMany({
        where: { userId, kind },
        select: { subjectKey: true },
      });
      return new Set(rows.map((row) => row.subjectKey));
    },

    dismiss: async (userId, kind, subjectKey, value = '') => {
      await prisma.aiDismissal.createMany({
        data: [{ userId, kind, subjectKey, value }],
        skipDuplicates: true,
      });
    },
  };
}
