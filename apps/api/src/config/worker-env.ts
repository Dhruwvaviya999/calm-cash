import { z } from 'zod';

import {
  checkEmailEnv,
  emailEnvFields,
  optionalString,
  toEmailConfig,
  type EmailConfig,
} from './email-env';
import {
  corsOriginsSchema,
  databaseUrlSchema,
  describeEnvIssues,
  LOG_LEVELS,
  NODE_ENVIRONMENTS,
  originSchema,
  type LogLevel,
  type NodeEnvironment,
} from './env';

// Configuration of the background worker (`apps/worker`). It reads the same `.env` as the API and
// the same e-mail rules (`email-env.ts`), so the two processes can never disagree about where mail
// may go. Values are validated once at startup and never printed.

export interface WorkerSettings {
  /** Stable name of this process in leases and heartbeats; generated when not set. */
  id: string | undefined;
  /** Pause between polling cycles when there was nothing to do. */
  pollIntervalMs: number;
  /** Jobs and deliveries claimed per cycle (each kind). */
  batchSize: number;
  /** How long a claim stays valid before another worker may recover it. */
  leaseMs: number;
  /** How often the scheduler enqueues the daily reviews and maintenance (idempotently). */
  schedulerIntervalMs: number;
  /** Local hour (in each user's time zone) at which their daily review becomes due. */
  dailyReviewHour: number;
  /** Optional loopback health endpoint (`GET /health`). */
  health: { host: string; port: number } | undefined;
}

export interface WorkerConfig {
  nodeEnv: NodeEnvironment;
  databaseUrl: string;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
  /** Origin of the web app; links in e-mails point here. */
  webAppUrl: string;
  email: EmailConfig;
  worker: WorkerSettings;
}

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
    DATABASE_URL: databaseUrlSchema,
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    WEB_APP_URL: optionalString.pipe(originSchema.optional()),
    CORS_ORIGINS: optionalString.pipe(corsOriginsSchema.optional()),
    ...emailEnvFields,
    WORKER_ID: optionalString.pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9._:-]{1,80}$/, 'Use letters, digits, ".", "_", ":", or "-" (≤ 80).')
        .optional(),
    ),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    WORKER_LEASE_MS: z.coerce.number().int().min(30_000).max(900_000).default(120_000),
    WORKER_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(3_600_000)
      .default(300_000),
    WORKER_DAILY_REVIEW_HOUR: z.coerce.number().int().min(0).max(23).default(8),
    WORKER_HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
    WORKER_HEALTH_PORT: optionalString
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .pipe(z.number().int().min(1).max(65_535).optional()),
  })
  .superRefine((env, context) => {
    const webAppUrl = env.WEB_APP_URL ?? env.CORS_ORIGINS?.[0];
    if (webAppUrl === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'Set WEB_APP_URL (or CORS_ORIGINS) so e-mails can link to the web app.',
      });
    } else if (env.NODE_ENV === 'production' && !webAppUrl.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'Production links must use https.',
      });
    }
    checkEmailEnv(env, context);
  });

export type WorkerEnvParseResult =
  { success: true; config: WorkerConfig } | { success: false; issues: readonly string[] };

/** Validates the worker's environment; issues name variables and rules, never values. */
export function parseWorkerEnv(
  source: Readonly<Record<string, string | undefined>>,
): WorkerEnvParseResult {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    return { success: false, issues: describeEnvIssues(result.error) };
  }
  const env = result.data;
  return {
    success: true,
    config: {
      nodeEnv: env.NODE_ENV,
      databaseUrl: env.DATABASE_URL,
      logLevel: env.LOG_LEVEL,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      webAppUrl: env.WEB_APP_URL ?? env.CORS_ORIGINS?.[0] ?? '',
      email: toEmailConfig(env),
      worker: {
        id: env.WORKER_ID,
        pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
        batchSize: env.WORKER_BATCH_SIZE,
        leaseMs: env.WORKER_LEASE_MS,
        schedulerIntervalMs: env.WORKER_SCHEDULER_INTERVAL_MS,
        dailyReviewHour: env.WORKER_DAILY_REVIEW_HOUR,
        health:
          env.WORKER_HEALTH_PORT === undefined
            ? undefined
            : { host: env.WORKER_HEALTH_HOST, port: env.WORKER_HEALTH_PORT },
      },
    },
  };
}
