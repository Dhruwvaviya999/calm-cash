import { z } from 'zod';

// E-mail delivery configuration shared by the API and the worker, so both processes read the same
// variables under the same rules. Delivery is never inferred from whichever credentials happen to
// be in `.env`: `EMAIL_DELIVERY_MODE` says it explicitly, and only production may reach an
// external mail server.

/**
 * - `mailpit`: the local Mailpit catcher only (loopback or the compose service), no credentials.
 *   The default outside production.
 * - `smtp`: a real provider. Allowed only when `NODE_ENV=production`.
 * - `disabled`: nothing is sent; every send fails as a permanent delivery error.
 */
export const EMAIL_DELIVERY_MODES = ['mailpit', 'smtp', 'disabled'] as const;
export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (usually port 465). When false, STARTTLS is used if the server offers it. */
  secure: boolean;
  /** Refuse to send without TLS (STARTTLS). Always true in production unless `secure`. */
  requireTls: boolean;
  auth: { user: string; password: string } | undefined;
}

export interface EmailConfig {
  mode: EmailDeliveryMode;
  /** RFC 5322 sender, e.g. `CalmCash <no-reply@calmcash.example>`. */
  from: string;
  smtp: SmtpConfig;
}

/** Host names that can only be this machine or the local Mailpit container. */
const LOCAL_MAIL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'mailpit']);

export function isLocalMailHost(host: string): boolean {
  return LOCAL_MAIL_HOSTS.has(host.trim().toLowerCase());
}

const booleanFlagSchema = z
  .enum(['true', 'false'], { error: 'Must be "true" or "false".' })
  .transform((value) => value === 'true');

/** Empty strings count as "not set", so `SMTP_USER=` in a .env file behaves like an absent value. */
export const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value));

/** Zod fields of the e-mail variables; merged into each process's environment schema. */
export const emailEnvFields = {
  EMAIL_DELIVERY_MODE: z
    .enum(EMAIL_DELIVERY_MODES, { error: 'Must be "mailpit", "smtp", or "disabled".' })
    .optional(),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: booleanFlagSchema.default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: optionalString,
};

export interface EmailEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  EMAIL_DELIVERY_MODE?: EmailDeliveryMode | undefined;
  SMTP_HOST?: string | undefined;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  EMAIL_FROM?: string | undefined;
}

interface IssueSink {
  addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void;
}

/** The delivery mode in effect: explicit, or `mailpit` outside production. */
export function resolveEmailDeliveryMode(env: EmailEnv): EmailDeliveryMode | undefined {
  return env.EMAIL_DELIVERY_MODE ?? (env.NODE_ENV === 'production' ? undefined : 'mailpit');
}

/**
 * Safety rules for e-mail delivery. Issues name the variable and the rule, never a value, so a
 * password or host never reaches the logs.
 */
export function checkEmailEnv(env: EmailEnv, context: IssueSink): void {
  const production = env.NODE_ENV === 'production';
  const mode = resolveEmailDeliveryMode(env);
  const issue = (path: string, message: string): void => {
    context.addIssue({ code: 'custom', path: [path], message });
  };

  if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
    issue(
      env.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASSWORD',
      'Set both SMTP_USER and SMTP_PASSWORD, or neither.',
    );
  }

  if (mode === undefined) {
    issue(
      'EMAIL_DELIVERY_MODE',
      'Required in production: "smtp" to send through your provider, or "disabled".',
    );
    return;
  }

  switch (mode) {
    case 'mailpit':
      if (production) {
        issue('EMAIL_DELIVERY_MODE', 'Mailpit is for local development; use "smtp" or "disabled".');
      }
      if (env.SMTP_HOST !== undefined && !isLocalMailHost(env.SMTP_HOST)) {
        issue(
          'SMTP_HOST',
          'With EMAIL_DELIVERY_MODE=mailpit only the local Mailpit is allowed (localhost, 127.0.0.1, ::1, or mailpit). External mail servers are refused outside production.',
        );
      }
      if (env.SMTP_USER !== undefined || env.SMTP_PASSWORD !== undefined) {
        issue(
          'SMTP_USER',
          'Mailpit needs no credentials. Remove SMTP_USER and SMTP_PASSWORD; real mail credentials belong only in a production environment.',
        );
      }
      break;
    case 'smtp':
      if (!production) {
        issue(
          'EMAIL_DELIVERY_MODE',
          'External SMTP delivery is only allowed when NODE_ENV=production. Use "mailpit" for development and tests.',
        );
      }
      // Development defaults point at the local Mailpit catcher; production must say where mail goes.
      for (const name of ['SMTP_HOST', 'EMAIL_FROM'] as const) {
        if (env[name] === undefined) {
          issue(name, 'Required with EMAIL_DELIVERY_MODE=smtp.');
        }
      }
      break;
    case 'disabled':
      break;
  }
}

/** The validated e-mail configuration (call only after `checkEmailEnv` reported no issue). */
export function toEmailConfig(env: EmailEnv): EmailConfig {
  const production = env.NODE_ENV === 'production';
  return {
    mode: resolveEmailDeliveryMode(env) ?? 'disabled',
    from: env.EMAIL_FROM ?? 'CalmCash <no-reply@calmcash.localhost>',
    smtp: {
      host: env.SMTP_HOST ?? 'localhost',
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTls: production && !env.SMTP_SECURE,
      auth:
        env.SMTP_USER === undefined || env.SMTP_PASSWORD === undefined
          ? undefined
          : { user: env.SMTP_USER, password: env.SMTP_PASSWORD },
    },
  };
}
