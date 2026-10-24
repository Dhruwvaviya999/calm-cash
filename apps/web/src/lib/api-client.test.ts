import { healthCheckDtoSchema, REQUEST_ID_HEADER } from '@calmcash/shared';
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
