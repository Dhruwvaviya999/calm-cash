import { describe, expect, it } from 'vitest';

import { isLocalMailHost } from './email-env';
import { parseEnv } from './env';
import { parseWorkerEnv } from './worker-env';

// The e-mail safety rules shared by the API and the worker. A development run once sent real
// verification e-mails through a personal Gmail account because `.env` happened to hold its
// credentials; these rules make that configuration impossible to start outside production.

const DEVELOPMENT = {
  DATABASE_URL: 'postgresql://calmcash:local-secret@localhost:5432/calmcash',
  CORS_ORIGINS: 'http://localhost:3000',
} as const;

const GMAIL = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_USER: 'someone@gmail.com',
  SMTP_PASSWORD: 'app-password-secret',
  EMAIL_FROM: 'Someone <someone@gmail.com>',
} as const;

function issuesOf(
  result: { success: true } | { success: false; issues: readonly string[] },
): string {
  return result.success ? '' : result.issues.join('\n');
}

const parsers = [
  ['API', parseEnv],
  ['worker', parseWorkerEnv],
] as const;

describe.each(parsers)('%s e-mail delivery rules', (_name, parse) => {
  it('defaults to the local Mailpit catcher outside production', () => {
    const result = parse(DEVELOPMENT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.email.mode).toBe('mailpit');
      expect(result.config.email.smtp).toMatchObject({ host: 'localhost', port: 1025 });
      expect(result.config.email.smtp.auth).toBeUndefined();
    }
  });

  it('refuses an external SMTP server in development, even with credentials present', () => {
    const issues = issuesOf(parse({ ...DEVELOPMENT, ...GMAIL }));
    expect(issues).toContain('SMTP_HOST');
    expect(issues).toContain('SMTP_USER');
    // Secrets and host names are never echoed back.
    expect(issues).not.toContain('app-password-secret');
    expect(issues).not.toContain('someone@gmail.com');
    expect(issues).not.toContain('smtp.gmail.com');
  });

  it('refuses an external SMTP server in tests: NODE_ENV=test alone is not a safeguard', () => {
    const issues = issuesOf(parse({ ...DEVELOPMENT, ...GMAIL, NODE_ENV: 'test' }));
    expect(issues).toContain('SMTP_HOST');
  });

  it('refuses smtp mode outside production', () => {
    for (const nodeEnv of ['development', 'test']) {
      const issues = issuesOf(
        parse({ ...DEVELOPMENT, ...GMAIL, NODE_ENV: nodeEnv, EMAIL_DELIVERY_MODE: 'smtp' }),
      );
      expect(issues).toContain('EMAIL_DELIVERY_MODE');
      expect(issues).toContain('only allowed when NODE_ENV=production');
    }
  });

  it('requires an explicit mode in production and refuses Mailpit there', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://calmcash:prod-secret@db.internal:5432/calmcash',
      CORS_ORIGINS: 'https://app.calmcash.example',
      RECEIPT_STORAGE_DIR: '/var/lib/calmcash/receipts',
    };
    expect(issuesOf(parse(production))).toContain('EMAIL_DELIVERY_MODE');
    expect(issuesOf(parse({ ...production, EMAIL_DELIVERY_MODE: 'mailpit' }))).toContain(
      'EMAIL_DELIVERY_MODE',
    );
    const smtp = parse({ ...production, ...GMAIL, EMAIL_DELIVERY_MODE: 'smtp' });
    expect(smtp.success).toBe(true);
    if (smtp.success) {
      expect(smtp.config.email).toMatchObject({
        mode: 'smtp',
        smtp: { host: 'smtp.gmail.com', requireTls: true },
      });
    }
  });

  it('allows the loopback addresses and the compose service name for Mailpit', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', 'mailpit', 'LOCALHOST']) {
      expect(parse({ ...DEVELOPMENT, SMTP_HOST: host }).success).toBe(true);
    }
    for (const host of ['mail.example.com', '10.0.0.5', 'localhost.evil.example', 'smtp']) {
      expect(parse({ ...DEVELOPMENT, SMTP_HOST: host }).success).toBe(false);
    }
  });

  it('can turn delivery off entirely', () => {
    const result = parse({ ...DEVELOPMENT, EMAIL_DELIVERY_MODE: 'disabled' });
    expect(result.success && result.config.email.mode).toBe('disabled');
  });
});

describe('isLocalMailHost', () => {
  it('accepts only names that cannot leave this machine or its compose network', () => {
    expect(isLocalMailHost(' localhost ')).toBe(true);
    expect(isLocalMailHost('[::1]')).toBe(true);
    expect(isLocalMailHost('127.0.0.2')).toBe(false);
    expect(isLocalMailHost('smtp.gmail.com')).toBe(false);
  });
});
