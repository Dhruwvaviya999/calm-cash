import type { z } from 'zod';

import { ApiClientError } from './api-client';

// Turns validation problems from the shared Zod schemas (client side) and from the API's
// `details` (server side) into one message per form field.

export type FieldErrors<TField extends string> = Partial<Record<TField, string | undefined>>;

function isField<TField extends string>(fields: readonly TField[], key: string): key is TField {
  return fields.some((field) => field === key);
}

/** First message per field from a Zod error; issues without a matching field are ignored. */
export function fieldErrorsFromZod<TField extends string>(
  error: z.ZodError,
  fields: readonly TField[],
): FieldErrors<TField> {
  const errors: FieldErrors<TField> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.');
    if (isField(fields, key) && errors[key] === undefined) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

/** Field messages from an API error whose `details` use request paths such as `body.email`. */
export function fieldErrorsFromApi<TField extends string>(
  error: unknown,
  fields: readonly TField[],
): FieldErrors<TField> {
  const errors: FieldErrors<TField> = {};
  if (!(error instanceof ApiClientError)) {
    return errors;
  }
  for (const detail of error.details ?? []) {
    const key = detail.path.replace(/^body\./, '');
    if (isField(fields, key) && errors[key] === undefined) {
      errors[key] = detail.message;
    }
  }
  return errors;
}

export function hasFieldErrors<TField extends string>(errors: FieldErrors<TField>): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

/**
 * A calm, user-facing sentence for any failed request. Messages written by the API for expected
 * failures are already safe to show; transport problems get a friendlier explanation.
 */
export function describeRequestError(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'NETWORK_ERROR':
        return 'CalmCash could not be reached. Check your connection and try again.';
      case 'INVALID_RESPONSE':
      case 'INTERNAL_ERROR':
        return 'Something went wrong on our side. Please try again in a moment.';
      case 'VALIDATION_ERROR':
        return 'Some details need your attention.';
      case 'BAD_REQUEST':
      case 'CONFLICT':
      case 'CSRF_TOKEN_INVALID':
      case 'EMAIL_DELIVERY_FAILED':
      case 'EMAIL_NOT_VERIFIED':
      case 'FORBIDDEN':
      case 'INVALID_CREDENTIALS':
      case 'INVALID_JSON':
      case 'INVALID_TOKEN':
      case 'NOT_FOUND':
      case 'ORIGIN_NOT_ALLOWED':
      case 'PAYLOAD_TOO_LARGE':
      case 'RATE_LIMITED':
      case 'SERVICE_UNAVAILABLE':
      case 'UNAUTHORIZED':
        // Expected failures carry a message written for end users.
        return error.message;
    }
  }
  return 'Something went wrong. Please try again.';
}
