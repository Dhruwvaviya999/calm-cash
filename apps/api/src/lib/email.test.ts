import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import type { EmailConfig } from '../config/email-env';
import {
  assertSafeEmailTransport,
  classifySmtpError,
  createSmtpEmailService,
  EmailDeliveryError,
} from './email';

const MAILPIT: EmailConfig = {
  mode: 'mailpit',
  from: 'CalmCash <no-reply@calmcash.localhost>',
  smtp: { host: 'localhost', port: 1025, secure: false, requireTls: false, auth: undefined },
};

function smtpError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('Message failed: 550 5.1.1 someone@example.com unknown'), fields);
}

describe('classifySmtpError', () => {
  it('stops retrying a rejected recipient', () => {
    expect(
      classifySmtpError(smtpError({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' })),
    ).toEqual({ kind: 'permanent', code: 'recipient_rejected' });
    expect(classifySmtpError(smtpError({ responseCode: 554, command: 'DATA' }))).toEqual({
      kind: 'permanent',
      code: 'smtp_5xx',
    });
    expect(classifySmtpError(smtpError({ code: 'EENVELOPE' }))).toEqual({
      kind: 'permanent',
      code: 'envelope',
    });
  });

  it('retries temporary refusals and servers that cannot be reached', () => {
    expect(classifySmtpError(smtpError({ responseCode: 451, command: 'DATA' }))).toEqual({
      kind: 'retryable',
      code: 'smtp_4xx',
    });
    expect(classifySmtpError(smtpError({ code: 'ECONNREFUSED' }))).toEqual({
      kind: 'retryable',
      code: 'unreachable',
    });
    expect(classifySmtpError(smtpError({ code: 'EAUTH', command: 'AUTH PLAIN' }))).toEqual({
      kind: 'retryable',
      code: 'auth',
    });
  });

  it('reports a dropped connection as ambiguous: the server may already have the message', () => {
    for (const code of ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET']) {
      expect(classifySmtpError(smtpError({ code, command: 'CONN' }))).toEqual({
        kind: 'ambiguous',
        code: 'connection',
      });
    }
    expect(classifySmtpError('not even an error')).toEqual({ kind: 'ambiguous', code: 'unknown' });
  });

  it('never carries the provider message (which can echo addresses) into its result', () => {
    const result = classifySmtpError(smtpError({ responseCode: 550, command: 'RCPT TO' }));
    expect(JSON.stringify(result)).not.toContain('example.com');
  });
});

describe('assertSafeEmailTransport', () => {
  it('accepts the local Mailpit only', () => {
    expect(() => {
      assertSafeEmailTransport(MAILPIT);
    }).not.toThrow();
    expect(() => {
      assertSafeEmailTransport({ ...MAILPIT, smtp: { ...MAILPIT.smtp, host: 'smtp.gmail.com' } });
    }).toThrow(/local mail server/);
    expect(() => {
      assertSafeEmailTransport({
        ...MAILPIT,
        smtp: { ...MAILPIT.smtp, auth: { user: 'someone', password: 'secret' } },
      });
    }).toThrow(/credentials/);
  });

  it('is enforced when the transport is built, not only when the environment is parsed', () => {
    const logger = pino({ level: 'silent' });
    expect(() =>
      createSmtpEmailService(
        { ...MAILPIT, smtp: { ...MAILPIT.smtp, host: 'smtp.gmail.com' } },
        logger,
      ),
    ).toThrow();
  });
});

describe('disabled delivery', () => {
  it('fails every send permanently without opening a connection', async () => {
    const service = createSmtpEmailService(
      { ...MAILPIT, mode: 'disabled' },
      pino({ level: 'silent' }),
    );
    const sending = service.send({
      to: 'someone@example.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
      template: 'test',
    });
    await expect(sending).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(sending).rejects.toMatchObject({ kind: 'permanent', code: 'email_disabled' });
    expect(await service.verifyConnection()).toBe(false);
  });
});
