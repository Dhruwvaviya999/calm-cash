/** Path prefix of the current API version. Clients append it to the configured API origin. */
export const API_V1_PREFIX = '/api/v1';

/** Header used to correlate a request across the web client, API logs, and error responses. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Header that carries the session's CSRF token on every state-changing authenticated request.
 * The web client keeps the token in memory only; it comes from the login or current-session
 * response.
 */
export const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * Optional header on requests that record money (`POST /transactions`, reconciliations): a UUID
 * chosen by the client for one logical operation. Repeating the request with the same key returns
 * the transaction recorded the first time instead of recording it again.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Machine-readable error codes returned in `ApiErrorResponse.error.code`. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  // Authentication and request-integrity failures.
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'INVALID_TOKEN',
  'CSRF_TOKEN_INVALID',
  'ORIGIN_NOT_ALLOWED',
  'EMAIL_DELIVERY_FAILED',
  // AI features (Phase 10): turned off (by the operator or the person), or the local model cannot
  // answer right now. Every other feature keeps working.
  'AI_DISABLED',
  'AI_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
