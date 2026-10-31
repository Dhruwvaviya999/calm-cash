import type { Server } from 'node:http';
import { hostname } from 'node:os';

import {
  createLogger,
  createPrismaClient,
  createSmtpEmailService,
  createWorkerRuntime,
  parseWorkerEnv,
} from '@calmcash/api/automation';

import { startHealthServer } from './health-server';
import { workerIdFor } from './worker-id';

// Process entry of the CalmCash worker: validate configuration, wire the automation engine, run
// it until SIGINT/SIGTERM, then stop cleanly. Reminders, alerts, summaries, and e-mails exist only
// while at least one worker runs; the work itself is durable in PostgreSQL, so a stopped worker
// resumes where it left off (within each job's expiry rules).

const env = parseWorkerEnv(process.env);

if (!env.success) {
  process.stderr.write(
    [
      'Invalid worker configuration:',
      ...env.issues.map((issue) => `  - ${issue}`),
      'The worker reads the same .env as the API; see .env.example.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const { config } = env;
const logger = createLogger(config, 'calmcash-worker');
const prisma = createPrismaClient(config.databaseUrl, logger);
const email = createSmtpEmailService(config.email, logger);
const workerId = config.worker.id ?? workerIdFor(hostname(), process.pid);

const runtime = createWorkerRuntime({
  prisma,
  email,
  logger,
  webAppUrl: config.webAppUrl,
  settings: {
    workerId,
    batchSize: config.worker.batchSize,
    leaseMs: config.worker.leaseMs,
    pollIntervalMs: config.worker.pollIntervalMs,
    schedulerIntervalMs: config.worker.schedulerIntervalMs,
    dailyReviewHour: config.worker.dailyReviewHour,
  },
});

let health: Server | undefined;
let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'Worker shutting down');
  const forceExit = setTimeout(() => {
    // Leases of anything still in progress expire and another worker recovers it.
    logger.error({ timeoutMs: config.shutdownTimeoutMs }, 'Worker shutdown timed out');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();
  let code = exitCode;
  try {
    await runtime.stop();
    await new Promise<void>((resolve) => {
      if (health === undefined) {
        resolve();
        return;
      }
      health.close(() => {
        resolve();
      });
    });
    email.close();
    await prisma.$disconnect();
    logger.info('Worker stopped');
  } catch (error: unknown) {
    logger.error({ err: error }, 'Error during worker shutdown');
    code = 1;
  } finally {
    clearTimeout(forceExit);
    process.exit(code);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal, 0);
  });
}
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error: Error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

if (config.worker.health !== undefined) {
  health = await startHealthServer({
    ...config.worker.health,
    // Several idle polls, or one long batch, without a finished cycle means something is wrong.
    staleAfterMs: Math.max(5 * config.worker.pollIntervalMs, config.worker.leaseMs),
    status: runtime.status,
  });
  logger.info({ ...config.worker.health }, 'Worker health endpoint listening');
}

logger.info(
  {
    workerId,
    emailMode: config.email.mode,
    batchSize: config.worker.batchSize,
    pollIntervalMs: config.worker.pollIntervalMs,
  },
  'CalmCash worker started',
);
void runtime.start();
