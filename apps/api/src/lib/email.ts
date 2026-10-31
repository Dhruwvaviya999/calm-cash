import { createTransport } from 'nodemailer';

import { isLocalMailHost, type EmailConfig } from '../config/email-env';
import type { Logger } from './logger';

/** A fully rendered message. Bodies may contain one-time links, so they are never logged. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Short template name used in logs instead of the recipient or the content. */
  template: string;
  /**
   * Stable `Message-ID` (without angle brackets). Retries of one delivery reuse it, so mail systems
   * that de-duplicate by message ID can drop a copy sent twice after an ambiguous failure.
   */
  messageId?: string;
}

/**
 * How a failed send should be treated:
 * - `retryable`: the server refused or could not be reached before accepting the message;
 * - `permanent`: retrying cannot help (rejected recipient, malformed message, delivery disabled);
 * - `ambiguous`: the connection failed at a point where the server may already have accepted the
 *   message — a retry may deliver a second copy.
 */
export type EmailFailureKind = 'retryable' | 'permanent' | 'ambiguous';

/**
 * Delivery boundary used by features. Implementations must reject with `EmailDeliveryError` when
 * a message could not be handed to the provider — never report success they cannot vouch for.
 */
export interface EmailService {
  send: (message: EmailMessage) => Promise<void>;
}

export class EmailDeliveryError extends Error {
  override readonly name = 'EmailDeliveryError';
  readonly kind: EmailFailureKind;
  /** Sanitised classification (`smtp_4xx`, `connection`, …); never a provider message. */
  readonly code: string;

  constructor(
    message: string,
    options: { cause?: unknown; kind?: EmailFailureKind; code?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.kind = options.kind ?? 'retryable';
    this.code = options.code ?? 'unknown';
  }
}

/** The structured fields nodemailer sets on its errors (anything else is ignored). */
function smtpErrorFields(error: unknown): {
  code: unknown;
  responseCode: unknown;
  command: unknown;
} {
  if (typeof error !== 'object' || error === null) {
    return { code: undefined, responseCode: undefined, command: undefined };
  }
  return {
    code: 'code' in error ? error.code : undefined,
    responseCode: 'responseCode' in error ? error.responseCode : undefined,
    command: 'command' in error ? error.command : undefined,
  };
}

const CONNECTION_REFUSED = new Set(['ECONNREFUSED', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN']);
const CONNECTION_LOST = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EPIPE']);

/**
 * Classifies a nodemailer failure from its `code`, `responseCode`, and `command` only — the
 * message text (which may echo addresses or content) is never read.
 */
export function classifySmtpError(error: unknown): { kind: EmailFailureKind; code: string } {
  const { code, responseCode, command } = smtpErrorFields(error);

  if (typeof responseCode === 'number') {
    if (responseCode >= 500) {
      // 5xx on the envelope means this recipient or sender will not be accepted.
      return { kind: 'permanent', code: command === 'RCPT TO' ? 'recipient_rejected' : 'smtp_5xx' };
    }
    if (responseCode >= 400) {
      return { kind: 'retryable', code: 'smtp_4xx' };
    }
  }
  if (code === 'EAUTH') return { kind: 'retryable', code: 'auth' };
  if (code === 'EENVELOPE') return { kind: 'permanent', code: 'envelope' };
  if (code === 'EMESSAGE') return { kind: 'permanent', code: 'message' };
  if (code === 'ETLS' || code === 'EREQUIRETLS') return { kind: 'retryable', code: 'tls' };
  if (typeof code === 'string' && CONNECTION_REFUSED.has(code)) {
    return { kind: 'retryable', code: 'unreachable' };
  }
  if (typeof code === 'string' && CONNECTION_LOST.has(code)) {
    // nodemailer reports a dropped connection the same way before and after the message data, so
    // the server may have accepted it already.
    return { kind: 'ambiguous', code: 'connection' };
  }
  return { kind: 'ambiguous', code: 'unknown' };
}

export interface SmtpEmailService extends EmailService {
  /** Resolves to `true` when the SMTP server accepts a connection. Never rejects. */
  verifyConnection: () => Promise<boolean>;
  close: () => void;
}

/**
 * Defence in depth behind the environment rules: refuses to build a transport that could reach an
 * external server unless the configuration explicitly chose `smtp` (which only production may).
 */
export function assertSafeEmailTransport(config: EmailConfig): void {
  if (config.mode === 'mailpit' && !isLocalMailHost(config.smtp.host)) {
    throw new Error('Refusing to send e-mail: Mailpit mode only allows a local mail server.');
  }
  if (config.mode === 'mailpit' && config.smtp.auth !== undefined) {
    throw new Error('Refusing to send e-mail: Mailpit mode must not carry SMTP credentials.');
  }
}

/** Delivery turned off (`EMAIL_DELIVERY_MODE=disabled`): every send fails permanently. */
function createDisabledEmailService(logger: Logger): SmtpEmailService {
  return {
    send: (message) => {
      logger.warn({ template: message.template }, 'E-mail not sent: delivery is disabled');
      return Promise.reject(
        new EmailDeliveryError('E-mail delivery is disabled.', {
          kind: 'permanent',
          code: 'email_disabled',
        }),
      );
    },
    verifyConnection: () => Promise.resolve(false),
    close: () => undefined,
  };
}

/** SMTP delivery (Mailpit locally, a real provider in production) through nodemailer. */
export function createSmtpEmailService(config: EmailConfig, logger: Logger): SmtpEmailService {
  if (config.mode === 'disabled') {
    return createDisabledEmailService(logger);
  }
  assertSafeEmailTransport(config);

  const transporter = createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: config.smtp.requireTls,
    ...(config.smtp.auth === undefined
      ? {}
      : { auth: { user: config.smtp.auth.user, pass: config.smtp.auth.password } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // nodemailer's own logging would print message content, including one-time links.
    logger: false,
    debug: false,
  });

  return {
    send: async (message) => {
      try {
        await transporter.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.messageId === undefined ? {} : { messageId: `<${message.messageId}>` }),
        });
        logger.info({ template: message.template }, 'E-mail handed to the SMTP server');
      } catch (error: unknown) {
        const { kind, code } = classifySmtpError(error);
        // Only the classification is logged: provider messages can echo addresses or content.
        logger.error({ template: message.template, kind, code }, 'E-mail delivery failed');
        throw new EmailDeliveryError('The e-mail could not be delivered.', {
          cause: error,
          kind,
          code,
        });
      }
    },

    verifyConnection: async () => {
      try {
        await transporter.verify();
        return true;
      } catch (error: unknown) {
        logger.warn({ code: classifySmtpError(error).code }, 'SMTP server is not reachable');
        return false;
      }
    },

    close: () => {
      transporter.close();
    },
  };
}
