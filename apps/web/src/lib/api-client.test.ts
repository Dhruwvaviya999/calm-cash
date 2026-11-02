import { CSRF_TOKEN_HEADER, healthCheckDtoSchema, REQUEST_ID_HEADER } from '@calmcash/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './api-client';

const HEALTH = { status: 'ok', uptimeSeconds: 42, timestamp: '2026-10-25T09:30:00.000Z' } as const;

function jsonResponse(body: unknown, status = 200, requestId = 'req-123'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: requestId },
  });
}

function clientReturning(response: Response | Error): {
  client: ReturnType<typeof createApiClient>;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
} {
  const fetchMock = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  return { client: createApiClient({ baseUrl: 'http://api.test/', fetch: fetchMock }), fetchMock };
}

async function captureError(promise: Promise<unknown>): Promise<ApiClientError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiClientError)) {
    throw new Error('Expected the request to fail with an ApiClientError.');
  }
  return error;
}

describe('createApiClient', () => {
  it('uses the shared public /api/v1 route for requests and downloads with no API origin', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: HEALTH }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71])));
    const client = createApiClient({ baseUrl: '', fetch: fetchMock });

    await client.request('/health', { schema: healthCheckDtoSchema });
    await client.download('/transactions/t/receipts/r/file');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/health');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/transactions/t/receipts/r/file');
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBe('include');
  });

  it('calls the versioned endpoint and returns the validated payload', async () => {
    const { client, fetchMock } = clientReturning(jsonResponse({ success: true, data: HEALTH }));

    const data = await client.request('/health', { schema: healthCheckDtoSchema });

    expect(data).toEqual(HEALTH);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/health');
  });

  it('sends JSON bodies with the matching content type', async () => {
    const { client, fetchMock } = clientReturning(jsonResponse({ success: true, data: HEALTH }));

    await client.request('/health', {
      schema: healthCheckDtoSchema,
      method: 'POST',
      body: { amountMinor: '12550' },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"amountMinor":"12550"}');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('turns API error envelopes into ApiClientError with code, status, and request ID', async () => {
    const { client } = clientReturning(
      jsonResponse(
        {
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Not ready.', requestId: 'req-503' },
        },
        503,
      ),
    );

    const error = await captureError(client.request('/health', { schema: healthCheckDtoSchema }));

    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, requestId: 'req-503' });
  });

  it('rejects success responses that do not match the expected schema', async () => {
    const { client } = clientReturning(
      jsonResponse({ success: true, data: { status: 'ok', uptimeSeconds: '42' } }),
    );

    const error = await captureError(client.request('/health', { schema: healthCheckDtoSchema }));

    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.requestId).toBe('req-123');
  });

  it('reports non-JSON error responses as INVALID_RESPONSE', async () => {
    const { client } = clientReturning(new Response('<html>Bad gateway</html>', { status: 502 }));

    const error = await captureError(client.request('/health', { schema: healthCheckDtoSchema }));

    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });

  it('reports unreachable servers as NETWORK_ERROR', async () => {
    const { client } = clientReturning(new TypeError('fetch failed'));

    const error = await captureError(client.request('/health', { schema: healthCheckDtoSchema }));

    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('sends credentials so the browser attaches the session cookie', async () => {
    const { client, fetchMock } = clientReturning(jsonResponse({ success: true, data: HEALTH }));

    await client.request('/health', { schema: healthCheckDtoSchema });

    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('re-throws caller-initiated aborts unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const { client } = clientReturning(abortError);

    await expect(
      client.request('/health', { schema: healthCheckDtoSchema, signal: controller.signal }),
    ).rejects.toBe(abortError);
  });
});

describe('files', () => {
  it('sends an uploaded file as the raw body with its own content type', async () => {
    const { client, fetchMock } = clientReturning(jsonResponse({ success: true, data: HEALTH }));
    const file = new Blob(['Date,Amount'], { type: 'text/csv' });

    await client.request('/imports?fileName=a.csv', {
      schema: healthCheckDtoSchema,
      method: 'POST',
      file,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(file);
    expect(init?.headers).toMatchObject({ 'Content-Type': 'text/csv' });
  });

  it('labels a file without a type as octet-stream, never as JSON', async () => {
    const { client, fetchMock } = clientReturning(jsonResponse({ success: true, data: HEALTH }));

    await client.request('/receipts', {
      schema: healthCheckDtoSchema,
      method: 'POST',
      file: new Blob([new Uint8Array([1, 2, 3])]),
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/octet-stream',
    });
  });

  it('downloads a private file with the session cookie', async () => {
    const { client, fetchMock } = clientReturning(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );

    const blob = await client.download('/transactions/t/receipts/r/file');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://api.test/api/v1/transactions/t/receipts/r/file',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include');
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('reports a failed download like any other request', async () => {
    const onUnauthorized = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'No such receipt.' } },
          404,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { success: false, error: { code: 'UNAUTHORIZED', message: 'Signed out.' } },
          401,
        ),
      );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: fetchMock,
      onUnauthorized,
    });

    const missing = await captureError(client.download('/x'));
    await captureError(client.download('/y'));

    expect(missing).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'No such receipt.' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('session integration', () => {
  const TOKEN = 't'.repeat(43);
  const csrfError = (): Response =>
    jsonResponse(
      { success: false, error: { code: 'CSRF_TOKEN_INVALID', message: 'Out of date.' } },
      403,
    );
  const unauthorized = (): Response =>
    jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'Signed out.' } }, 401);

  function headersOf(init: RequestInit | undefined): Record<string, string> {
    const { headers } = init ?? {};
    return headers !== undefined && !(headers instanceof Headers) && !Array.isArray(headers)
      ? headers
      : {};
  }

  it('attaches the in-memory CSRF token to state-changing requests only', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ success: true, data: HEALTH })),
    );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: fetchMock,
      getCsrfToken: () => TOKEN,
    });

    await client.request('/health', { schema: healthCheckDtoSchema });
    await client.request('/health', { schema: healthCheckDtoSchema, method: 'PATCH', body: {} });

    expect(headersOf(fetchMock.mock.calls[0]?.[1])).not.toHaveProperty(CSRF_TOKEN_HEADER);
    expect(headersOf(fetchMock.mock.calls[1]?.[1])[CSRF_TOKEN_HEADER]).toBe(TOKEN);
  });

  it('refreshes a rejected CSRF token and retries the request once', async () => {
    let token = 'stale'.padEnd(43, 's');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(csrfError())
      .mockResolvedValueOnce(jsonResponse({ success: true, data: HEALTH }));
    const refreshCsrfToken = vi.fn(() => {
      token = TOKEN;
      return Promise.resolve(true);
    });
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: fetchMock,
      getCsrfToken: () => token,
      refreshCsrfToken,
    });

    const data = await client.request('/health', {
      schema: healthCheckDtoSchema,
      method: 'POST',
      body: {},
    });

    expect(data).toEqual(HEALTH);
    expect(refreshCsrfToken).toHaveBeenCalledOnce();
    expect(headersOf(fetchMock.mock.calls[1]?.[1])[CSRF_TOKEN_HEADER]).toBe(TOKEN);
  });

  it('does not retry more than once', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(csrfError()));
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: fetchMock,
      getCsrfToken: () => TOKEN,
      refreshCsrfToken: () => Promise.resolve(true),
    });

    const error = await captureError(
      client.request('/health', { schema: healthCheckDtoSchema, method: 'POST', body: {} }),
    );

    expect(error.code).toBe('CSRF_TOKEN_INVALID');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports ended sessions, but not other authentication failures', async () => {
    const onUnauthorized = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(
        jsonResponse(
          { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Wrong password.' } },
          401,
        ),
      );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: fetchMock,
      onUnauthorized,
    });

    await captureError(client.request('/auth/me', { schema: healthCheckDtoSchema }));
    await captureError(
      client.request('/auth/login', { schema: healthCheckDtoSchema, method: 'POST', body: {} }),
    );

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
