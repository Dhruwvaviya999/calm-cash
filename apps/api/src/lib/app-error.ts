import type { ApiErrorDetail, ErrorCode } from '@calmcash/shared';

export interface AppErrorOptions {
  details?: ApiErrorDetail[];
  cause?: unknown;
}

/**
 * An expected failure whose status, code, and message are safe to return to the client.
 * Any other error that reaches the error handler is reported as a generic 500.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: ApiErrorDetail[] | undefined;

  constructor(statusCode: number, code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
  }
}
