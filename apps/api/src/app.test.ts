import {
  API_V1_PREFIX,
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  CSRF_TOKEN_HEADER,
  healthCheckDtoSchema,
  readinessCheckDtoSchema,
  REQUEST_ID_HEADER,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTH_RATE_LIMITS } from './modules/auth/auth.rate-limits';
import {
  createOfflineAuthDependencies,
  createTestApp,
  TEST_ALLOWED_ORIGIN,
} from './testing/create-test-app';

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

  it('allows the CSRF header in credentialed cross-origin requests from the web app', async () => {
    const response = await request(createTestApp())
      .options(`${API_V1_PREFIX}/auth/profile`)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', `content-type,${CSRF_TOKEN_HEADER}`)
      .expect(204);

    expect(response.get('Access-Control-Allow-Headers')).toContain(CSRF_TOKEN_HEADER);
    expect(response.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.get('Access-Control-Allow-Origin')).toBe(TEST_ALLOWED_ORIGIN);
  });
});

describe('request origin verification', () => {
  it('rejects state-changing requests from disallowed origins with 403 ORIGIN_NOT_ALLOWED', async () => {
    const app = createTestApp();

    for (const origin of ['https://evil.example', 'null', 'http://localhost:3001']) {
      const response = await request(app)
        .post(`${API_V1_PREFIX}/auth/login`)
        .set('Origin', origin)
        .send({ email: 'asha@example.com', password: 'whatever' })
        .expect(403);
      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('ORIGIN_NOT_ALLOWED');
    }
  });

  it('rejects cross-site browser requests that omit the Origin header', async () => {
    await request(createTestApp())
      .post(`${API_V1_PREFIX}/auth/forgot-password`)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'asha@example.com' })
      .expect(403);
  });

  it('lets the web app origin through to validation', async () => {
    const response = await request(createTestApp())
      .post(`${API_V1_PREFIX}/auth/login`)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('never applies to safe methods', async () => {
    await request(createTestApp())
      .get(`${API_V1_PREFIX}/health`)
      .set('Origin', 'https://evil.example')
      .expect(200);
  });
});

describe('authentication boundary (no database)', () => {
  it('rejects protected requests without a session cookie before any lookup', async () => {
    const response = await request(createTestApp())
      .patch(`${API_V1_PREFIX}/auth/profile`)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ name: 'Mallory' })
      .expect(401);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('UNAUTHORIZED');
    expect(response.get('Cache-Control')).toBe('no-store');
  });

  it('protects every financial route before touching the database', async () => {
    const app = createTestApp();
    for (const path of ['/transactions', '/transactions/summary', '/categories', '/tags']) {
      const response = await request(app).get(`${API_V1_PREFIX}${path}`).expect(401);
      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('UNAUTHORIZED');
    }
    await request(app)
      .post(`${API_V1_PREFIX}/transactions`)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({})
      .expect(401);
  });

  it('allows the idempotency header in cross-origin requests from the web app', async () => {
    const response = await request(createTestApp())
      .options(`${API_V1_PREFIX}/transactions`)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key,x-csrf-token')
      .expect(204);
    expect(response.get('Access-Control-Allow-Headers')).toContain('idempotency-key');
  });

  it('rate-limits repeated failed sign-ins from one client', async () => {
    const app = createTestApp({
      auth: createOfflineAuthDependencies({
        rateLimits: {
          ...DEFAULT_AUTH_RATE_LIMITS,
          loginPerIp: { limit: 2, windowMs: 60_000 },
        },
      }),
    });
    const attempt = (): request.Test =>
      request(app).post(`${API_V1_PREFIX}/auth/login`).set('Origin', TEST_ALLOWED_ORIGIN).send({});

    await attempt().expect(400);
    await attempt().expect(400);
    const limited = await attempt().expect(429);

    expect(apiErrorResponseSchema.parse(limited.body).error.code).toBe('RATE_LIMITED');
    expect(limited.get('RateLimit-Policy')).toBeDefined();
  });
});
