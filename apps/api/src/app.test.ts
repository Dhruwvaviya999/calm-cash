import {
  API_V1_PREFIX,
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  healthCheckDtoSchema,
  readinessCheckDtoSchema,
  REQUEST_ID_HEADER,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createTestApp, TEST_ALLOWED_ORIGIN } from './testing/create-test-app';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe(`GET ${API_V1_PREFIX}/health`, () => {
  it('returns the liveness payload in the standard success envelope', async () => {
    const response = await request(createTestApp())
      .get(`${API_V1_PREFIX}/health`)
      .expect(200)
      .expect('Content-Type', /application\/json/);

    const body = apiSuccessResponseSchema(healthCheckDtoSchema).parse(response.body);
    expect(body.data.status).toBe('ok');
    expect(response.get('Cache-Control')).toBe('no-store');
  });

  it('does not depend on the database', async () => {
    const app = createTestApp({ checkDatabase: () => Promise.resolve(false) });
    await request(app).get(`${API_V1_PREFIX}/health`).expect(200);
  });

  it('assigns a request ID, or reuses a well-formed incoming one', async () => {
    const app = createTestApp();

    const generated = await request(app).get(`${API_V1_PREFIX}/health`);
    expect(generated.get(REQUEST_ID_HEADER)).toMatch(UUID_PATTERN);

    const propagated = await request(app)
      .get(`${API_V1_PREFIX}/health`)
      .set(REQUEST_ID_HEADER, 'trace-abc-123');
    expect(propagated.get(REQUEST_ID_HEADER)).toBe('trace-abc-123');

    for (const unsafe of ['spaces and "quotes"', 'x'.repeat(129)]) {
      const rejected = await request(app)
        .get(`${API_V1_PREFIX}/health`)
        .set(REQUEST_ID_HEADER, unsafe);
      expect(rejected.get(REQUEST_ID_HEADER)).toMatch(UUID_PATTERN);
    }
  });
});

describe(`GET ${API_V1_PREFIX}/health/ready`, () => {
  it('reports ready when the database is reachable', async () => {
    const response = await request(createTestApp())
      .get(`${API_V1_PREFIX}/health/ready`)
      .expect(200);

    const body = apiSuccessResponseSchema(readinessCheckDtoSchema).parse(response.body);
    expect(body.data.checks.database).toBe('up');
  });

  it('returns 503 in the standard error envelope when the database is down', async () => {
    const app = createTestApp({ checkDatabase: () => Promise.resolve(false) });
    const response = await request(app).get(`${API_V1_PREFIX}/health/ready`).expect(503);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.requestId).toBe(response.get(REQUEST_ID_HEADER));
  });
});

describe('error handling', () => {
  it('returns a typed 404 for unknown routes', async () => {
    const response = await request(createTestApp())
      .get(`${API_V1_PREFIX}/does-not-exist`)
      .expect(404);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/api/v1/does-not-exist');
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const response = await request(createTestApp())
      .post(`${API_V1_PREFIX}/health`)
      .set('Content-Type', 'application/json')
      .send('{"amountMinor": ')
      .expect(400);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('INVALID_JSON');
  });

  it('rejects bodies above the configured limit with 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await request(createTestApp())
      .post(`${API_V1_PREFIX}/health`)
      .send({ notes: 'x'.repeat(2048) })
      .expect(413);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('security middleware', () => {
  it('sets security headers and hides the framework', async () => {
    const response = await request(createTestApp()).get(`${API_V1_PREFIX}/health`);

    expect(response.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.get('X-Powered-By')).toBeUndefined();
  });

  it('allows the configured frontend origin only', async () => {
    const app = createTestApp();

    const allowed = await request(app)
      .get(`${API_V1_PREFIX}/health`)
      .set('Origin', TEST_ALLOWED_ORIGIN);
    expect(allowed.get('Access-Control-Allow-Origin')).toBe(TEST_ALLOWED_ORIGIN);
    expect(allowed.get('Access-Control-Allow-Credentials')).toBe('true');

    const blocked = await request(app)
      .get(`${API_V1_PREFIX}/health`)
      .set('Origin', 'https://evil.example');
    expect(blocked.get('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('answers CORS preflight requests for the allowed origin', async () => {
    const response = await request(createTestApp())
      .options(`${API_V1_PREFIX}/health`)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(response.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
