import { z } from 'zod';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Validated, typed runtime configuration of the API. Never read `process.env` elsewhere. */
export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  databaseUrl: string;
  corsOrigins: readonly string[];
  jsonBodyLimit: string;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
}

const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => new URL(value).origin === value, {
    message: 'Must be a bare origin such as "https://app.example.com" (no path or trailing slash).',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
  API_HOST: z.string().min(1).default('localhost'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.url({
    protocol: /^postgres(?:ql)?$/,
    error: 'Must be a PostgreSQL connection URL (postgresql://user:password@host:port/database).',
  }),
  CORS_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(originSchema).min(1, 'At least one origin is required.')),
  JSON_BODY_LIMIT: z
    .string()
    .regex(/^\d+(?:b|kb|mb)$/i, 'Must be a size such as "100kb" or "1mb".')
    .default('100kb'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
});

export type EnvParseResult =
  { success: true; config: AppConfig } | { success: false; issues: readonly string[] };

/**
 * Validates environment variables. Reported issues name the variable and the rule that failed but
 * never include the supplied value, so secrets such as DATABASE_URL cannot leak into logs.
 */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvParseResult {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map((issue) => {
        const variable = issue.path.map(String).join('.') || '(environment)';
        return `${variable}: ${issue.message}`;
      }),
    };
  }

  const env = result.data;
  return {
    success: true,
    config: {
      nodeEnv: env.NODE_ENV,
      host: env.API_HOST,
      port: env.API_PORT,
      databaseUrl: env.DATABASE_URL,
      corsOrigins: env.CORS_ORIGINS,
      jsonBodyLimit: env.JSON_BODY_LIMIT,
      logLevel: env.LOG_LEVEL,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    },
  };
}
