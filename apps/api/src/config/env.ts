import { z } from 'zod';

import {
  checkEmailEnv,
  emailEnvFields,
  optionalString,
  toEmailConfig,
  type EmailConfig,
} from './email-env';

export type { EmailConfig, EmailDeliveryMode, SmtpConfig } from './email-env';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** How the session cookie is written. Production uses the `__Host-` prefix, which requires `Secure`. */
export interface SessionConfig {
  cookieName: string;
  /** `Secure` attribute; always true in production. */
  secureCookie: boolean;
  /** Absolute session lifetime, regardless of activity. */
  maxAgeMs: number;
  /** A session unused for this long is no longer accepted. */
  idleTimeoutMs: number;
}

/** Validated, typed runtime configuration of the API. Never read `process.env` elsewhere. */
export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  databaseUrl: string;
  corsOrigins: readonly string[];
  /** Origin of the web app; links in e-mails point here. Always one of `corsOrigins`. */
  webAppUrl: string;
  /** Number of reverse proxies in front of the API whose `X-Forwarded-For` can be trusted. */
  trustProxyHops: number;
  jsonBodyLimit: string;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
  session: SessionConfig;
  email: EmailConfig;
  /** Private directory for receipt files (relative paths resolve against the working directory). */
  receiptStorageDir: string;
}

const DEVELOPMENT_SESSION_COOKIE = 'calmcash_session';
/** `__Host-` cookies must be Secure, have `Path=/`, and no `Domain`, so they stay host-only. */
const PRODUCTION_SESSION_COOKIE = '__Host-calmcash_session';

/** Development default; ignored by Git. */
const DEFAULT_RECEIPT_STORAGE_DIR = '.data/receipts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => new URL(value).origin === value, {
    message: 'Must be a bare origin such as "https://app.example.com" (no path or trailing slash).',
  });

export const databaseUrlSchema = z.url({
  protocol: /^postgres(?:ql)?$/,
  error: 'Must be a PostgreSQL connection URL (postgresql://user:password@host:port/database).',
});

export const corsOriginsSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(originSchema).min(1, 'At least one origin is required.'));

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
    API_HOST: z.string().min(1).default('localhost'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: databaseUrlSchema,
    CORS_ORIGINS: corsOriginsSchema,
    WEB_APP_URL: optionalString.pipe(originSchema.optional()),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    JSON_BODY_LIMIT: z
      .string()
      .regex(/^\d+(?:b|kb|mb)$/i, 'Must be a size such as "100kb" or "1mb".')
      .default('100kb'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    SESSION_IDLE_TIMEOUT_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(90 * 24)
      .default(72),
    ...emailEnvFields,
    RECEIPT_STORAGE_DIR: optionalString,
  })
  .superRefine((env, context) => {
    const production = env.NODE_ENV === 'production';
    const webAppUrl = env.WEB_APP_URL ?? env.CORS_ORIGINS[0];

    if (webAppUrl !== undefined && !env.CORS_ORIGINS.includes(webAppUrl)) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'Must be one of the origins listed in CORS_ORIGINS.',
      });
    }
    if (env.SESSION_IDLE_TIMEOUT_HOURS > env.SESSION_MAX_AGE_DAYS * 24) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_IDLE_TIMEOUT_HOURS'],
        message: 'Must not exceed SESSION_MAX_AGE_DAYS.',
      });
    }
    checkEmailEnv(env, context);

    if (production) {
      // Secure cookies only reach the API over HTTPS, and e-mailed links must be HTTPS too.
      for (const origin of env.CORS_ORIGINS) {
        if (!origin.startsWith('https://')) {
          context.addIssue({
            code: 'custom',
            path: ['CORS_ORIGINS'],
            message: 'Production origins must use https.',
          });
          break;
        }
      }
      // Receipts must live on persistent, private storage in production, never a default path.
      if (env.RECEIPT_STORAGE_DIR === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['RECEIPT_STORAGE_DIR'],
          message: 'Required in production (a private directory on a persistent volume).',
        });
      }
    }
  });

/** `VARIABLE: rule` lines for a failed environment parse; values are never included. */
export function describeEnvIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const variable = issue.path.map(String).join('.') || '(environment)';
    return `${variable}: ${issue.message}`;
  });
}

export type EnvParseResult =
  { success: true; config: AppConfig } | { success: false; issues: readonly string[] };

/**
 * Validates environment variables. Reported issues name the variable and the rule that failed but
 * never include the supplied value, so secrets such as DATABASE_URL cannot leak into logs.
 */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvParseResult {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    return { success: false, issues: describeEnvIssues(result.error) };
  }

  const env = result.data;
  const production = env.NODE_ENV === 'production';
  const [firstOrigin = ''] = env.CORS_ORIGINS;

  return {
    success: true,
    config: {
      nodeEnv: env.NODE_ENV,
      host: env.API_HOST,
      port: env.API_PORT,
      databaseUrl: env.DATABASE_URL,
      corsOrigins: env.CORS_ORIGINS,
      webAppUrl: env.WEB_APP_URL ?? firstOrigin,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      jsonBodyLimit: env.JSON_BODY_LIMIT,
      logLevel: env.LOG_LEVEL,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      session: {
        cookieName: production ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE,
        secureCookie: production,
        maxAgeMs: env.SESSION_MAX_AGE_DAYS * DAY_MS,
        idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_HOURS * HOUR_MS,
      },
      email: toEmailConfig(env),
      receiptStorageDir: env.RECEIPT_STORAGE_DIR ?? DEFAULT_RECEIPT_STORAGE_DIR,
    },
  };
}
