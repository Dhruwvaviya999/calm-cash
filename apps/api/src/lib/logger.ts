import { pino, type Logger } from 'pino';

import type { AppConfig } from '../config/env';

export type { Logger } from 'pino';

/** Structured JSON logger. Credentials in request/response headers are always redacted. */
export function createLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): Logger {
  return pino({
    level: config.logLevel,
    base: { service: 'calmcash-api', env: config.nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
  });
}
