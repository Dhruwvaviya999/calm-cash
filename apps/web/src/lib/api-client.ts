import {
  API_V1_PREFIX,
  apiErrorResponseSchema,
  CSRF_TOKEN_HEADER,
  REQUEST_ID_HEADER,
  type ApiErrorDetail,
  type ErrorCode,
} from '@calmcash/shared';
import { z } from 'zod';

/** Error codes produced by the API plus failures detected on the client side. */
export type ApiClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export interface ApiClientErrorInit {
  code: ApiClientErrorCode;
  message: string;
  status?: number | undefined;
  requestId?: string | undefined;
  details?: ApiErrorDetail[] | undefined;
  cause?: unknown;
}

/** The only error type the API client throws (apart from re-throwing caller-initiated aborts). */
export class ApiClientError extends Error {
  override readonly name = 'ApiClientError';
  readonly code: ApiClientErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly details: ApiErrorDetail[] | undefined;

  constructor({ code, message, status, requestId, details, cause }: ApiClientErrorInit) {
    super(message, { cause });
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions<TSchema extends z.ZodType> {
  /** Validates the `data` payload of the success envelope at runtime. */
  schema: TSchema;
  method?: HttpMethod;
  /** Serialized as JSON. */
  body?: unknown;
  signal?: AbortSignal | undefined;
  headers?: Readonly<Record<string, string>>;
}

export interface ApiClient {
  /** Calls `path` relative to `/api/v1` and resolves with the validated response payload. */
  request: <TSchema extends z.ZodType>(
    path: `/${string}`,
    options: ApiRequestOptions<TSchema>,
  ) => Promise<z.output<TSchema>>;
}

export interface ApiClientConfig {
  /** API origin without a version prefix, e.g. `http://localhost:4000`. */
  baseUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** The session's CSRF token, sent as `x-csrf-token` on state-changing requests. */
  getCsrfToken?: () => string | undefined;
  /**
   * Called once when the API rejects the CSRF token (for example after the session was rotated in
   * another tab). Resolve `true` once a fresh token is available, and the request is retried once.
   */
  refreshCsrfToken?: () => Promise<boolean>;
  /** Called when the API answers `UNAUTHORIZED`: the session is missing, expired, or revoked. */
  onUnauthorized?: () => void;
}

const successEnvelopeSchema = z.object({ success: z.literal(true), data: z.unknown() });

async function readJson(response: Response): Promise<unknown> {
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch {
    return undefined;
  }
}

export function createApiClient({
  baseUrl,
  fetch: fetchImpl = fetch,
  getCsrfToken,
  refreshCsrfToken,
  onUnauthorized,
}: ApiClientConfig): ApiClient {
  const apiRoot = `${baseUrl.replace(/\/+$/, '')}${API_V1_PREFIX}`;

  const send = async <TSchema extends z.ZodType>(
    path: `/${string}`,
    options: ApiRequestOptions<TSchema>,
    allowCsrfRetry: boolean,
  ): Promise<z.output<TSchema>> => {
    const { schema, method = 'GET', body, signal, headers } = options;
    const csrfToken = method === 'GET' ? undefined : getCsrfToken?.();

    let response: Response;
    try {
      response = await fetchImpl(`${apiRoot}${path}`, {
        method,
        // The session is an HttpOnly cookie of the API host; the browser attaches it.
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(csrfToken === undefined ? {} : { [CSRF_TOKEN_HEADER]: csrfToken }),
          ...headers,
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (error: unknown) {
      if (signal?.aborted === true) {
        throw error; // Cancellation is the caller's decision, not an API failure.
      }
      throw new ApiClientError({
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the CalmCash API.',
        cause: error,
      });
    }

    const payload = await readJson(response);
    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;

    if (!response.ok) {
      const parsedError = apiErrorResponseSchema.safeParse(payload);
      if (parsedError.success) {
        const { code, message, details, requestId: errorRequestId } = parsedError.data.error;

        if (
          code === 'CSRF_TOKEN_INVALID' &&
          allowCsrfRetry &&
          refreshCsrfToken !== undefined &&
          (await refreshCsrfToken())
        ) {
          return send(path, options, false);
        }
        if (code === 'UNAUTHORIZED') {
          onUnauthorized?.();
        }

        throw new ApiClientError({
          code,
          message,
          details,
          status: response.status,
          requestId: errorRequestId ?? requestId,
        });
      }
      throw new ApiClientError({
        code: 'INVALID_RESPONSE',
        message: `The API responded with an unexpected ${response.status} error.`,
        status: response.status,
        requestId,
      });
    }

    const envelope = successEnvelopeSchema.safeParse(payload);
    const data = envelope.success ? schema.safeParse(envelope.data.data) : undefined;
    if (data?.success !== true) {
      throw new ApiClientError({
        code: 'INVALID_RESPONSE',
        message: 'The API returned a response in an unexpected format.',
        status: response.status,
        requestId,
        cause: data?.error ?? envelope.error,
      });
    }
    return data.data;
  };

  return {
    request: (path, options) => send(path, options, true),
  };
}
