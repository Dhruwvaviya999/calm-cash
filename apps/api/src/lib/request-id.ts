import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { REQUEST_ID_HEADER } from '@calmcash/shared';

/** Accept a caller-supplied ID only if it is short and cannot inject content into logs. */
const SAFE_REQUEST_ID = /^[\w-]{1,128}$/;

/**
 * Reuses a well-formed incoming `x-request-id` (e.g. from a proxy) or generates a new one,
 * and echoes it on the response so clients can quote it in bug reports.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  return requestId;
}

/** Reads the ID assigned by the request logger, if any. */
export function getRequestId(req: IncomingMessage): string | undefined {
  return typeof req.id === 'string' ? req.id : undefined;
}
