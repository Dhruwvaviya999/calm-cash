import { API_V1_PREFIX } from '@calmcash/shared';
import { pinoHttp, type HttpLogger } from 'pino-http';

import type { Logger } from '../lib/logger';
import { resolveRequestId } from '../lib/request-id';

const HEALTH_PATH_PREFIX = `${API_V1_PREFIX}/health`;

/** Shape of the request object produced by pino's standard request serializer. */
interface SerializedRequest {
  id: unknown;
  method: string;
  url: string;
  remoteAddress?: string;
}

/**
 * Assigns a request ID and logs one compact line per completed request (health probes excluded).
 * Headers are deliberately not logged, which keeps credentials and personal data out of logs.
 */
export function createRequestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: resolveRequestId,
    serializers: {
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    autoLogging: {
      ignore: (req) => req.url?.startsWith(HEALTH_PATH_PREFIX) ?? false,
    },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) {
        return 'error';
      }
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
  });
}
