/** Path prefix of the current API version. Clients append it to the configured API origin. */
export const API_V1_PREFIX = '/api/v1';

/** Header used to correlate a request across the web client, API logs, and error responses. */
export const REQUEST_ID_HEADER = 'x-request-id';

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
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
