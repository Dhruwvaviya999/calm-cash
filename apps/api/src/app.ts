import { API_V1_PREFIX, CSRF_TOKEN_HEADER, REQUEST_ID_HEADER } from '@calmcash/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/env';
import type { DatabaseHealthCheck } from './lib/database';
import type { Logger } from './lib/logger';
import { createErrorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { createOriginCheck } from './middleware/origin-check';
import { createRequestLogger } from './middleware/request-logger';
import type { AuthModuleDependencies } from './modules/auth/auth.routes';
import { createV1Router } from './routes/v1';

export interface AppDependencies {
  config: Pick<
    AppConfig,
    'corsOrigins' | 'jsonBodyLimit' | 'session' | 'webAppUrl' | 'trustProxyHops'
  >;
  logger: Logger;
  checkDatabase: DatabaseHealthCheck;
  auth: AuthModuleDependencies;
}

/**
 * Builds the Express application without binding a port, so tests can exercise it in-process.
 * Middleware order matters: logging/request ID → security headers → CORS → origin check →
 * body parsing → routes → 404 → error handler.
 */
export function createApp({ config, logger, checkDatabase, auth }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  // Only proxies we were told about may set the client IP (used by rate limiting).
  app.set('trust proxy', config.trustProxyHops);

  app.use(createRequestLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: [...config.corsOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER, CSRF_TOKEN_HEADER],
      exposedHeaders: [REQUEST_ID_HEADER],
      maxAge: 600,
    }),
  );
  app.use(createOriginCheck(config.corsOrigins));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use(
    API_V1_PREFIX,
    createV1Router({
      checkDatabase,
      auth,
      authConfig: { session: config.session, webAppUrl: config.webAppUrl },
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
