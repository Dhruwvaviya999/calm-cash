import { pino, type Logger } from 'pino';

import type { AppConfig } from '../config/env';

export type { Logger } from 'pino';

/**
 * Structured JSON logger. Credentials in request/response headers are always redacted. The worker
 * passes its own `service` name so both processes can share one log pipeline.
 */
export function createLogger(
  config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>,
  service = 'calmcash-api',
): Logger {
  return pino({
    level: config.logLevel,
    base: { service, env: config.nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
  });
}
