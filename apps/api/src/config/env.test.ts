import { describe, expect, it } from 'vitest';

import { parseEnv } from './env';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://calmcash:local-secret@localhost:5432/calmcash',
  CORS_ORIGINS: 'http://localhost:3000',
} as const;

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  EMAIL_DELIVERY_MODE: 'smtp',
  DATABASE_URL: 'postgresql://calmcash:prod-secret@db.internal:5432/calmcash',
  CORS_ORIGINS: 'https://app.calmcash.example',
  SMTP_HOST: 'smtp.mail.example',
  SMTP_PORT: '587',
  SMTP_USER: 'calmcash',
  SMTP_PASSWORD: 'smtp-secret',
  EMAIL_FROM: 'CalmCash <no-reply@calmcash.example>',
  RECEIPT_STORAGE_DIR: '/var/lib/calmcash/receipts',
} as const;

function issuesOf(result: ReturnType<typeof parseEnv>): string {
  return result.success ? '' : result.issues.join('\n');
}

describe('parseEnv', () => {
  it('applies documented defaults for optional variables', () => {
    const result = parseEnv(VALID_ENV);

    expect(result).toEqual({
      success: true,
      config: {
        nodeEnv: 'development',
        host: 'localhost',
        port: 4000,
        databaseUrl: VALID_ENV.DATABASE_URL,
        corsOrigins: ['http://localhost:3000'],
        webAppUrl: 'http://localhost:3000',
        trustProxyHops: 0,
        jsonBodyLimit: '100kb',
        logLevel: 'info',
        shutdownTimeoutMs: 10_000,
        session: {
          cookieName: 'calmcash_session',
          secureCookie: false,
          maxAgeMs: 14 * 24 * 60 * 60 * 1000,
          idleTimeoutMs: 72 * 60 * 60 * 1000,
        },
        email: {
          mode: 'mailpit',
          from: 'CalmCash <no-reply@calmcash.localhost>',
          smtp: {
            host: 'localhost',
            port: 1025,
            secure: false,
            requireTls: false,
            auth: undefined,
          },
        },
        receiptStorageDir: '.data/receipts',
        ai: {
          enabled: true,
          baseUrl: 'http://127.0.0.1:11434',
          model: 'qwen3:1.7b',
          requestTimeoutMs: 120_000,
          maxConcurrent: 1,
          maxQueue: 4,
          contextTokens: 4_096,
          maxOutputTokens: 512,
          maxPromptChars: 12_000,
          disableThinking: true,
          rateLimit: { limit: 30, windowMs: 600_000 },
        },
      },
    });
  });

  it('parses typed values and comma-separated origins', () => {
    const result = parseEnv({
      ...VALID_ENV,
      NODE_ENV: 'production',
      API_PORT: '8080',
      CORS_ORIGINS: 'https://app.calmcash.example, https://admin.calmcash.example',
      WEB_APP_URL: 'https://app.calmcash.example',
      EMAIL_DELIVERY_MODE: 'smtp',
      SMTP_HOST: 'smtp.mail.example',
      EMAIL_FROM: 'CalmCash <no-reply@calmcash.example>',
      RECEIPT_STORAGE_DIR: '/var/lib/calmcash/receipts',
    });

    expect(result.success && result.config.port).toBe(8080);
    expect(result.success && result.config.corsOrigins).toEqual([
      'https://app.calmcash.example',
      'https://admin.calmcash.example',
    ]);
  });

  it('reports every missing required variable by name', () => {
    const result = parseEnv({});

    expect(result.success).toBe(false);
    const issues = issuesOf(result);
    expect(issues).toContain('DATABASE_URL');
    expect(issues).toContain('CORS_ORIGINS');
  });

  it('rejects invalid values without echoing them back', () => {
    const secret = 'SuperSecretPassword123';
    const result = parseEnv({
      DATABASE_URL: `mysql://calmcash:${secret}@localhost:3306/calmcash`,
      CORS_ORIGINS: 'http://localhost:3000/dashboard',
      API_PORT: '99999',
      LOG_LEVEL: 'verbose',
    });

    expect(result.success).toBe(false);
    const issues = issuesOf(result);
    expect(issues).toContain('DATABASE_URL');
    expect(issues).toContain('CORS_ORIGINS');
    expect(issues).toContain('API_PORT');
    expect(issues).toContain('LOG_LEVEL');
    expect(issues).not.toContain(secret);
  });

  it('uses a Secure __Host- session cookie and enforced TLS in production', () => {
    const result = parseEnv(PRODUCTION_ENV);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.config.session).toMatchObject({
      cookieName: '__Host-calmcash_session',
      secureCookie: true,
    });
    expect(result.config.email.smtp).toMatchObject({
      host: 'smtp.mail.example',
      port: 587,
      requireTls: true,
      auth: { user: 'calmcash', password: 'smtp-secret' },
    });
  });

  it('requires explicit mail settings and https origins in production', () => {
    const result = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: PRODUCTION_ENV.DATABASE_URL,
      CORS_ORIGINS: 'http://app.calmcash.example',
    });

    const issues = issuesOf(result);
    expect(issues).toContain('CORS_ORIGINS: Production origins must use https.');
    // Delivery is never guessed: production must say how e-mail is sent.
    expect(issues).toContain('EMAIL_DELIVERY_MODE');
    expect(issues).toContain('RECEIPT_STORAGE_DIR');

    const smtp = issuesOf(
      parseEnv({
        NODE_ENV: 'production',
        EMAIL_DELIVERY_MODE: 'smtp',
        DATABASE_URL: PRODUCTION_ENV.DATABASE_URL,
        CORS_ORIGINS: 'https://app.calmcash.example',
      }),
    );
    expect(smtp).toContain('SMTP_HOST');
    expect(smtp).toContain('EMAIL_FROM');
  });

  it('keeps the web app origin inside the CORS allow-list', () => {
    const result = parseEnv({ ...VALID_ENV, WEB_APP_URL: 'https://elsewhere.example' });

    expect(issuesOf(result)).toContain('WEB_APP_URL');
  });

  it('requires SMTP credentials in pairs and never prints them', () => {
    const result = parseEnv({ ...VALID_ENV, SMTP_PASSWORD: 'only-the-password' });

    const issues = issuesOf(result);
    expect(issues).toContain('SMTP_USER');
    expect(issues).not.toContain('only-the-password');
  });

  it('rejects an idle timeout longer than the session lifetime', () => {
    const result = parseEnv({
      ...VALID_ENV,
      SESSION_MAX_AGE_DAYS: '1',
      SESSION_IDLE_TIMEOUT_HOURS: '48',
    });

    expect(issuesOf(result)).toContain('SESSION_IDLE_TIMEOUT_HOURS');
  });
});
