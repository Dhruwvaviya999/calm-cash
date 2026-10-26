import type { Express } from 'express';
import { pino } from 'pino';

import { createApp, type AppDependencies } from '../app';
import { createBackgroundTasks } from '../lib/background-tasks';
import { createPrismaClient } from '../lib/database';
import { createPrismaAccountsRepository } from '../modules/accounts/accounts.repository';
import { createPrismaAuthRepository } from '../modules/auth/auth.repository';
import { createPrismaCategoriesRepository } from '../modules/categories/categories.repository';
import { createPrismaTagsRepository } from '../modules/tags/tags.repository';
import { createPrismaTransactionsRepository } from '../modules/transactions/transactions.repository';
import { createArgon2PasswordHasher } from '../modules/auth/password-hasher';
import { createInMemoryEmailService } from './in-memory-email';

export const TEST_ALLOWED_ORIGIN = 'http://localhost:3000';

export const TEST_SESSION_CONFIG: AppDependencies['config']['session'] = {
  cookieName: 'calmcash_session',
  secureCookie: false,
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  idleTimeoutMs: 72 * 60 * 60 * 1000,
};

/** Cheap Argon2id parameters: tests exercise behaviour, not hashing cost. */
export const FAST_ARGON2_PARAMETERS = { memoryCost: 1024, timeCost: 1, parallelism: 1 } as const;

export const TEST_APP_CONFIG: AppDependencies['config'] = {
  corsOrigins: [TEST_ALLOWED_ORIGIN],
  jsonBodyLimit: '1kb',
  session: TEST_SESSION_CONFIG,
  webAppUrl: TEST_ALLOWED_ORIGIN,
  trustProxyHops: 0,
};

/**
 * Authentication dependencies for tests without a database. The Prisma client points at an
 * unreachable address and connects lazily, so nothing is opened unless a test reaches a
 * database-backed step (those scenarios live in the integration suite).
 */
export function createOfflineAuthDependencies(
  overrides: Partial<AppDependencies['auth']> = {},
): AppDependencies['auth'] {
  const logger = pino({ level: 'silent' });
  const offlinePrisma = createPrismaClient(
    'postgresql://offline:offline@127.0.0.1:9/offline',
    logger,
  );
  return {
    repository: createPrismaAuthRepository(offlinePrisma),
    passwordHasher: createArgon2PasswordHasher(FAST_ARGON2_PARAMETERS),
    emailService: createInMemoryEmailService(),
    backgroundTasks: createBackgroundTasks(logger),
    ...overrides,
  };
}

/** Builds the real application with silent logging and a stubbed database check. */
export function createTestApp(overrides: Partial<AppDependencies> = {}): Express {
  const logger = pino({ level: 'silent' });
  const offline = createPrismaClient('postgresql://offline:offline@127.0.0.1:9/offline', logger);
  return createApp({
    config: TEST_APP_CONFIG,
    logger,
    checkDatabase: () => Promise.resolve(true),
    auth: createOfflineAuthDependencies(),
    accounts: { repository: createPrismaAccountsRepository(offline) },
    transactions: { repository: createPrismaTransactionsRepository(offline) },
    categories: { repository: createPrismaCategoriesRepository(offline) },
    tags: { repository: createPrismaTagsRepository(offline) },
    ...overrides,
  });
}
