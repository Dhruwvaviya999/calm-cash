import { API_V1_PREFIX, REQUEST_ID_HEADER } from '@calmcash/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/env';
import type { DatabaseHealthCheck } from './lib/database';
import type { Logger } from './lib/logger';
import { createErrorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { createRequestLogger } from './middleware/request-logger';
import { createV1Router } from './routes/v1';

export interface AppDependencies {
  config: Pick<AppConfig, 'corsOrigins' | 'jsonBodyLimit'>;
  logger: Logger;
  checkDatabase: DatabaseHealthCheck;
}

/**
 * Builds the Express application without binding a port, so tests can exercise it in-process.
 * Middleware order matters: logging/request ID → security headers → CORS → body parsing →
 * routes → 404 → error handler.
 */
export function createApp({ config, logger, checkDatabase }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(createRequestLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: [...config.corsOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER],
      exposedHeaders: [REQUEST_ID_HEADER],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use(API_V1_PREFIX, createV1Router({ checkDatabase }));

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
