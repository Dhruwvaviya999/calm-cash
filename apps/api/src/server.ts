import { API_V1_PREFIX } from '@calmcash/shared';

import { createApp } from './app';
import { parseEnv } from './config/env';
import { createDatabaseHealthCheck, createPrismaClient } from './lib/database';
import { createLogger } from './lib/logger';
import { registerGracefulShutdown } from './lib/shutdown';

// Process entry point: validate configuration, wire dependencies, bind the port.
// All application behaviour lives in `createApp` so it can be tested without a network socket.

const env = parseEnv(process.env);

if (!env.success) {
  process.stderr.write(
    [
      'Invalid environment configuration:',
      ...env.issues.map((issue) => `  - ${issue}`),
      'Copy .env.example to .env in the repository root and adjust the values.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const { config } = env;
const logger = createLogger(config);
const prisma = createPrismaClient(config.databaseUrl, logger);

const app = createApp({
  config,
  logger,
  checkDatabase: createDatabaseHealthCheck(prisma, logger),
});

const server = app.listen(config.port, config.host, (error) => {
  if (error !== undefined) {
    logger.fatal({ err: error }, 'Failed to start the HTTP server');
    void prisma.$disconnect().finally(() => process.exit(1));
    return;
  }
  logger.info(
    { url: `http://${config.host}:${config.port}${API_V1_PREFIX}` },
    'CalmCash API listening',
  );
});

registerGracefulShutdown({
  server,
  logger,
  timeoutMs: config.shutdownTimeoutMs,
  cleanup: () => prisma.$disconnect(),
});
