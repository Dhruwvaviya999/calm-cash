import { API_V1_PREFIX } from '@calmcash/shared';

import { createApp } from './app';
import { parseEnv } from './config/env';
import { createBackgroundTasks } from './lib/background-tasks';
import { createDatabaseHealthCheck, createPrismaClient } from './lib/database';
import { createSmtpEmailService } from './lib/email';
import { createLogger } from './lib/logger';
import { registerGracefulShutdown } from './lib/shutdown';
import { createPrismaAccountsRepository } from './modules/accounts/accounts.repository';
import { createPrismaAuthRepository } from './modules/auth/auth.repository';
import { createPrismaBudgetsRepository } from './modules/budgets/budgets.repository';
import { createPrismaCategoriesRepository } from './modules/categories/categories.repository';
import { createPrismaDashboardRepository } from './modules/dashboard/dashboard.repository';
import { createPrismaGoalsRepository } from './modules/goals/goals.repository';
import { createPrismaImportsRepository } from './modules/imports/imports.repository';
import { createPrismaNotificationsRepository } from './modules/notifications';
import { createPrismaAiRepository } from './modules/ai/ai.repository';
import { createOllamaProvider } from './modules/ai/provider/ollama-provider';
import { createPrismaInsightsRepository } from './modules/insights/insights.repository';
import { createPrismaReceiptsRepository } from './modules/receipts/receipts.repository';
import { createLocalFileStorage } from './lib/file-storage';
import { createPrismaRecurringRepository } from './modules/recurring';
import { createPrismaTagsRepository } from './modules/tags/tags.repository';
import { createPrismaTransactionsRepository } from './modules/transactions/transactions.repository';
import { createArgon2PasswordHasher } from './modules/auth/password-hasher';
import { scheduleSessionCleanup } from './modules/auth/session-cleanup';

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
const emailService = createSmtpEmailService(config.email, logger);
const backgroundTasks = createBackgroundTasks(logger);
const authRepository = createPrismaAuthRepository(prisma);

const app = createApp({
  config,
  logger,
  checkDatabase: createDatabaseHealthCheck(prisma, logger),
  auth: {
    repository: authRepository,
    passwordHasher: createArgon2PasswordHasher(),
    emailService,
    backgroundTasks,
  },
  accounts: { repository: createPrismaAccountsRepository(prisma) },
  transactions: { repository: createPrismaTransactionsRepository(prisma) },
  categories: { repository: createPrismaCategoriesRepository(prisma) },
  tags: { repository: createPrismaTagsRepository(prisma) },
  dashboard: { repository: createPrismaDashboardRepository(prisma) },
  budgets: { repository: createPrismaBudgetsRepository(prisma) },
  recurring: { repository: createPrismaRecurringRepository(prisma) },
  goals: { repository: createPrismaGoalsRepository(prisma) },
  imports: { repository: createPrismaImportsRepository(prisma) },
  receipts: {
    repository: createPrismaReceiptsRepository(prisma),
    storage: createLocalFileStorage(config.receiptStorageDir),
  },
  notifications: { repository: createPrismaNotificationsRepository(prisma) },
  ai: {
    repository: createPrismaAiRepository(prisma),
    provider: createOllamaProvider({ config: config.ai, logger }),
    config: config.ai,
  },
  insights: { repository: createPrismaInsightsRepository(prisma) },
});

const stopSessionCleanup = scheduleSessionCleanup({
  repository: authRepository,
  session: config.session,
  logger,
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
  // Sign-up and password recovery need e-mail; say so early instead of at the first sign-up.
  void emailService.verifyConnection().then((reachable) => {
    if (reachable) {
      logger.info({ host: config.email.smtp.host }, 'SMTP server reachable');
    }
  });
});

registerGracefulShutdown({
  server,
  logger,
  timeoutMs: config.shutdownTimeoutMs,
  cleanup: async () => {
    stopSessionCleanup();
    await backgroundTasks.drain();
    emailService.close();
    await prisma.$disconnect();
  },
});
