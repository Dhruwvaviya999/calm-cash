import {
  addDaysToIsoDate,
  amountFilterToMinorUnits,
  CURRENCY_CODES,
  normalizeTag,
  startOfDayInTimeZone,
  type TransactionFilterQuery,
  type TransactionSort,
} from '@calmcash/shared';

import type { Prisma } from '../../generated/prisma/client';

// Turns validated list filters into a Prisma query. Every value is bound as a parameter by Prisma,
// sort keys come from a fixed allow-list, and every query is scoped by the owner's user ID.

/** `%`, `_`, and `\` are wildcards in SQL `LIKE`; search text must only ever match literally. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function amountWhere(
  minAmount: string | undefined,
  maxAmount: string | undefined,
): Prisma.TransactionWhereInput | undefined {
  if (minAmount === undefined && maxAmount === undefined) {
    return undefined;
  }
  // Bounds are per currency: "500" is 50000 paise but 500 yen.
  return {
    OR: CURRENCY_CODES.map((currency) => ({
      currency,
      amountMinor: {
        ...(minAmount === undefined
          ? {}
          : { gte: amountFilterToMinorUnits(minAmount, currency, 'lower') }),
        ...(maxAmount === undefined
          ? {}
          : { lte: amountFilterToMinorUnits(maxAmount, currency, 'upper') }),
      },
    })),
  };
}

function searchWhere(q: string): Prisma.TransactionWhereInput {
  const contains = { contains: escapeLikePattern(q), mode: 'insensitive' } as const;
  return {
    OR: [
      { description: contains },
      { merchant: contains },
      { notes: contains },
      { category: { name: contains } },
      { category: { parent: { name: contains } } },
      { tags: { has: normalizeTag(q) } },
    ],
  };
}

/**
 * The `WHERE` clause shared by the list and the summary, so both always describe the same
 * transactions. Calendar dates are interpreted in the user's time zone: `to` includes the whole
 * day, up to (not including) the next local midnight.
 */
export function transactionWhere(
  userId: string,
  filters: TransactionFilterQuery,
  timeZone: string,
): Prisma.TransactionWhereInput {
  const conditions: Prisma.TransactionWhereInput[] = [];

  if (filters.status === 'active') {
    conditions.push({ voidedAt: null });
  } else if (filters.status === 'voided') {
    conditions.push({ voidedAt: { not: null } });
  }
  if (filters.type !== undefined) {
    conditions.push({ type: filters.type });
  }
  if (filters.accountId !== undefined) {
    conditions.push({
      OR: [{ accountId: filters.accountId }, { transferAccountId: filters.accountId }],
    });
  }
  if (filters.categoryId !== undefined) {
    conditions.push({
      OR: [{ categoryId: filters.categoryId }, { category: { parentId: filters.categoryId } }],
    });
  }
  if (filters.currency !== undefined) {
    conditions.push({ currency: filters.currency });
  }
  if (filters.paymentMethod !== undefined) {
    conditions.push({ paymentMethod: filters.paymentMethod });
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    conditions.push({ tags: { hasEvery: filters.tags } });
  }
  if (filters.from !== undefined) {
    conditions.push({ occurredAt: { gte: startOfDayInTimeZone(filters.from, timeZone) } });
  }
  if (filters.to !== undefined) {
    conditions.push({
      occurredAt: { lt: startOfDayInTimeZone(addDaysToIsoDate(filters.to, 1), timeZone) },
    });
  }
  const amounts = amountWhere(filters.minAmount, filters.maxAmount);
  if (amounts !== undefined) {
    conditions.push(amounts);
  }
  if (filters.q !== undefined) {
    conditions.push(searchWhere(filters.q));
  }

  return { userId, AND: conditions };
}

/** Every order ends with the ID, so equal keys never make rows jump between pages. */
export function transactionOrderBy(
  sort: TransactionSort,
): Prisma.TransactionOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ occurredAt: 'desc' }, { id: 'desc' }];
    case 'oldest':
      return [{ occurredAt: 'asc' }, { id: 'asc' }];
    case 'largest':
      return [{ amountMinor: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }];
    case 'smallest':
      return [{ amountMinor: 'asc' }, { occurredAt: 'desc' }, { id: 'desc' }];
  }
}
