import type { ApiError, ApiErrorResponse, ErrorCode } from '@calmcash/shared';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../lib/app-error';
import { sendError } from '../lib/http-response';
import { getRequestId } from '../lib/request-id';
import { toValidationDetails } from './validate-request';

interface ErrorResolution {
  statusCode: number;
  error: Omit<ApiError, 'requestId'>;
}

/** Client errors raised by Express' body parser (http-errors), identified by their `type`. */
const BODY_PARSER_ERRORS: Readonly<Record<string, { code: ErrorCode; message: string }>> = {
  'entity.parse.failed': { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' },
  'entity.too.large': {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The request body exceeds the maximum allowed size.',
  },
};

interface HttpClientError {
  status: number;
  type: string | undefined;
}

function asHttpClientError(error: unknown): HttpClientError | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const { status } = error;
  if (typeof status !== 'number' || status < 400 || status > 499) {
    return undefined;
  }
  const type = 'type' in error && typeof error.type === 'string' ? error.type : undefined;
  return { status, type };
}

/** Maps any thrown value to a safe status code and error body. Unknown errors become 500s. */
export function resolveError(error: unknown): ErrorResolution {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        details: toValidationDetails(error),
      },
    };
  }

  const httpError = asHttpClientError(error);
  if (httpError !== undefined) {
    const known = httpError.type === undefined ? undefined : BODY_PARSER_ERRORS[httpError.type];
    return {
      statusCode: httpError.status,
      error: known ?? { code: 'BAD_REQUEST', message: 'The request could not be processed.' },
    };
  }

  return {
    statusCode: 500,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  };
}

/**
 * Final middleware: converts every error into the standard error envelope. Relies on the request
 * logger (mounted first in `createApp`) for `req.log` and the request ID.
 */
export function createErrorHandler(): ErrorRequestHandler {
  return (
    error: unknown,
    req: Request,
    res: Response<ApiErrorResponse>,
    next: NextFunction,
  ): void => {
    const { statusCode, error: apiError } = resolveError(error);

    if (statusCode >= 500) {
      // Full details go to the logs only; the client receives a generic message.
      req.log.error({ err: error }, 'Unhandled error while processing request');
    }

    if (res.headersSent) {
      // Too late to send a JSON body; let Express close the connection.
      next(error);
      return;
    }

    const requestId = getRequestId(req);
    sendError(res, statusCode, requestId === undefined ? apiError : { ...apiError, requestId });
  };
}
