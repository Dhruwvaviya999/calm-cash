import { AUTH_TOKEN_PATTERN } from '@calmcash/shared';

import { EmailDeliveryError, type EmailMessage, type EmailService } from '../lib/email';

/** Test double that records messages instead of delivering them, and can simulate outages. */
export interface InMemoryEmailService extends EmailService {
  readonly outbox: EmailMessage[];
  /** While true, `send` rejects like an unreachable SMTP server. */
  failing: boolean;
  /** Messages sent to `address`, oldest first. */
  messagesTo: (address: string) => EmailMessage[];
  /** The `token` query parameter of the newest link sent to `address` with the given template. */
  latestToken: (address: string, template: string) => string;
}

export function createInMemoryEmailService(): InMemoryEmailService {
  const outbox: EmailMessage[] = [];

  const service: InMemoryEmailService = {
    outbox,
    failing: false,
    send: (message) => {
      if (service.failing) {
        return Promise.reject(new EmailDeliveryError('Simulated SMTP outage.'));
      }
      outbox.push(message);
      return Promise.resolve();
    },
    messagesTo: (address) => outbox.filter((message) => message.to === address),
    latestToken: (address, template) => {
      const message = service
        .messagesTo(address)
        .filter((candidate) => candidate.template === template)
        .at(-1);
      const match = message?.text.match(/[?&]token=([A-Za-z0-9_-]+)/);
      const token = match?.[1];
      if (token === undefined || !AUTH_TOKEN_PATTERN.test(token)) {
        throw new Error(`No ${template} link was sent to ${address}.`);
      }
      return token;
    },
  };
  return service;
}
