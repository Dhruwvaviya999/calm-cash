import type { TagUsageDto } from '@calmcash/shared';
import { z } from 'zod';

import type { PrismaClient } from '../../generated/prisma/client';

// Tags live on transactions (a `varchar[]` column), so a user's tags are exactly the tags on their
// own transactions: ownership needs no extra table.

export interface TagsRepository {
  /** Tags on the user's active transactions, most used first. */
  listUsage: (userId: string, limit: number) => Promise<TagUsageDto[]>;
}

const tagRowSchema = z.object({ tag: z.string(), count: z.number().int().nonnegative() });

export function createPrismaTagsRepository(prisma: PrismaClient): TagsRepository {
  return {
    listUsage: async (userId, limit) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT tag::text AS "tag", COUNT(*)::int AS "count"
        FROM transactions t
        CROSS JOIN LATERAL unnest(t.tags) AS tag
        WHERE t.user_id = ${userId}::uuid AND t.voided_at IS NULL
        GROUP BY tag
        ORDER BY COUNT(*) DESC, tag ASC
        LIMIT ${limit}`;
      return z.array(tagRowSchema).parse(rows);
    },
  };
}
