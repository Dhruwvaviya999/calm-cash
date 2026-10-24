import type { Express } from 'express';
import { pino } from 'pino';

import { createApp, type AppDependencies } from '../app';

export const TEST_ALLOWED_ORIGIN = 'http://localhost:3000';

/** Builds the real application with silent logging and a stubbed database check. */
export function createTestApp(overrides: Partial<AppDependencies> = {}): Express {
  return createApp({
    config: { corsOrigins: [TEST_ALLOWED_ORIGIN], jsonBodyLimit: '1kb' },
    logger: pino({ level: 'silent' }),
    checkDatabase: () => Promise.resolve(true),
    ...overrides,
  });
}
