import { createTransport } from 'nodemailer';

import type { EmailConfig } from '../config/env';
import type { Logger } from './logger';

/** A fully rendered message. Bodies may contain one-time links, so they are never logged. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Short template name used in logs instead of the recipient or the content. */
  template: string;
}

/**
 * Delivery boundary used by features. Implementations must reject with `EmailDeliveryError` when
 * a message could not be handed to the provider — never report success they cannot vouch for.
 */
export interface EmailService {
  send: (message: EmailMessage) => Promise<void>;
}

export class EmailDeliveryError extends Error {
  override readonly name = 'EmailDeliveryError';
}

export interface SmtpEmailService extends EmailService {
  /** Resolves to `true` when the SMTP server accepts a connection. Never rejects. */
  verifyConnection: () => Promise<boolean>;
  close: () => void;
}

/** SMTP delivery (Mailpit locally, a real provider in production) through nodemailer. */
export function createSmtpEmailService(config: EmailConfig, logger: Logger): SmtpEmailService {
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
        });
        logger.info({ template: message.template }, 'E-mail handed to the SMTP server');
      } catch (error: unknown) {
        // The error describes the SMTP conversation, not the message body.
        logger.error({ err: error, template: message.template }, 'E-mail delivery failed');
        throw new EmailDeliveryError('The e-mail could not be delivered.', { cause: error });
      }
    },

    verifyConnection: async () => {
      try {
        await transporter.verify();
        return true;
      } catch (error: unknown) {
        logger.warn({ err: error }, 'SMTP server is not reachable');
        return false;
      }
    },

    close: () => {
      transporter.close();
    },
  };
}
