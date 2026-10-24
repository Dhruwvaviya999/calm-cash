import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';
import type { Logger } from './logger';

export type { PrismaClient } from '../generated/prisma/client';

/** Resolves to `true` when the database answers a trivial query. Never rejects. */
export type DatabaseHealthCheck = () => Promise<boolean>;

/**
 * Creates the application's single Prisma client, backed by a `pg` connection pool.
 * The pool connects lazily; call `$disconnect()` during shutdown to close it.
 */
export function createPrismaClient(databaseUrl: string, logger: Logger): PrismaClient {
  const adapter = new PrismaPg(
    { connectionString: databaseUrl, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 },
    {
      onPoolError: (error) => {
        logger.error({ err: error }, 'PostgreSQL pool error');
      },
    },
  );
  return new PrismaClient({ adapter });
}

export function createDatabaseHealthCheck(
  prisma: PrismaClient,
  logger: Logger,
): DatabaseHealthCheck {
  return async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error: unknown) {
      logger.warn({ err: error }, 'Database health check failed');
      return false;
    }
  };
}
