import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  authSessionDtoSchema,
  CSRF_TOKEN_HEADER,
  REQUEST_ID_HEADER,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { TEST_SESSION_CONFIG } from '../../testing/create-test-app';
import {
  AUTH,
  cookieHeader,
  createVerifiedUser,
  fromApp,
  SESSION_COOKIE,
  signIn,
  useIntegrationDatabase,
  withCsrf,
} from '../../testing/integration-harness';
import { hashToken } from './tokens';

const { prisma, createContext } = useIntegrationDatabase();

const SECRET_FIELDS = /passwordHash|tokenHash|csrfTokenHash|\$argon2/;

describe('POST /auth/login', () => {
  it('opens a session with a hardened cookie and returns the user and a CSRF token', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);

    const response = await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: credentials.email.toUpperCase(), password: credentials.password })
      .expect(200);

    const cookies: unknown = response.headers['set-cookie'];
    const cookie = Array.isArray(cookies) ? String(cookies[0]) : '';
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).toMatch(/Expires=/);
    expect(response.get('Cache-Control')).toBe('no-store');

    const body = apiSuccessResponseSchema(authSessionDtoSchema).parse(response.body);
    expect(body.data.user).toMatchObject({ name: credentials.name, email: credentials.email });
    expect(body.data.user.emailVerifiedAt).toBeDefined();
    expect(JSON.stringify(response.body)).not.toMatch(SECRET_FIELDS);

    // Only hashes are persisted; neither the cookie value nor the CSRF token is stored.
    const token = /=([^;]+)/.exec(cookie)?.[1] ?? '';
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(hashToken(token));
    expect(sessions[0]?.csrfTokenHash).toBe(hashToken(body.data.csrfToken));
    expect(sessions[0]?.deviceLabel).toBeNull();
    expect(JSON.stringify(sessions)).not.toContain(token);
    expect(JSON.stringify(sessions)).not.toContain(body.data.csrfToken);
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);

    const wrongPassword = await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: credentials.email, password: 'not the right passphrase' })
      .expect(401);
    const unknownEmail = await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: 'nobody@example.com', password: 'not the right passphrase' })
      .expect(401);

    const first = apiErrorResponseSchema.parse(wrongPassword.body).error;
    const second = apiErrorResponseSchema.parse(unknownEmail.body).error;
    expect({ ...first, requestId: undefined }).toEqual({ ...second, requestId: undefined });
    expect(first.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.session.count()).toBe(0);
  });

  it('replaces the session presented with the request (no session fixation)', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const first = await signIn(context, credentials);

    const second = await fromApp(first.agent.post(`${AUTH}/login`))
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const sessions = await prisma.session.findMany({ orderBy: { createdAt: 'asc' } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.revokedAt).not.toBeNull();
    expect(sessions[1]?.revokedAt).toBeNull();
    await request(context.app)
      .get(`${AUTH}/me`)
      .set('Cookie', cookieHeader(first.cookieValue))
      .expect(401);
    expect(
      apiSuccessResponseSchema(authSessionDtoSchema).parse(second.body).data.csrfToken,
    ).not.toBe(first.session.csrfToken);
  });
});

describe('GET /auth/me', () => {
  it('restores the signed-in state, including the same CSRF token', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const signedIn = await signIn(context, credentials);

    const response = await signedIn.agent.get(`${AUTH}/me`).expect(200);

    const body = apiSuccessResponseSchema(authSessionDtoSchema).parse(response.body);
    expect(body.data).toEqual(signedIn.session);
    expect(JSON.stringify(response.body)).not.toMatch(SECRET_FIELDS);
  });

  it('returns the standard 401 envelope without a session', async () => {
    const context = createContext();

    const response = await request(context.app).get(`${AUTH}/me`).expect(401);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.requestId).toBe(response.get(REQUEST_ID_HEADER));
  });

  it('rejects and clears an unknown session cookie', async () => {
    const context = createContext();

    const response = await request(context.app)
      .get(`${AUTH}/me`)
      .set('Cookie', cookieHeader('B'.repeat(43)))
      .expect(401);

    expect(String(response.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
  });

  it('rejects sessions past their absolute lifetime', async () => {
    const context = createContext();
    const signedIn = await signIn(context, await createVerifiedUser(context));

    // Stay active (within the idle timeout) right up to the absolute expiry.
    const step = TEST_SESSION_CONFIG.idleTimeoutMs - 60_000;
    let elapsed = 0;
    while (elapsed + step < TEST_SESSION_CONFIG.maxAgeMs) {
      context.clock.advance(step);
      elapsed += step;
      await signedIn.agent.get(`${AUTH}/me`).expect(200);
    }
    context.clock.advance(TEST_SESSION_CONFIG.maxAgeMs - elapsed);

    await signedIn.agent.get(`${AUTH}/me`).expect(401);
  });

  it('rejects sessions that were idle longer than the idle timeout', async () => {
    const context = createContext();
    const signedIn = await signIn(context, await createVerifiedUser(context));

    context.clock.advance(TEST_SESSION_CONFIG.idleTimeoutMs - 60_000);
    await signedIn.agent.get(`${AUTH}/me`).expect(200);
    context.clock.advance(TEST_SESSION_CONFIG.idleTimeoutMs + 1);

    await signedIn.agent.get(`${AUTH}/me`).expect(401);
  });

  it('rejects revoked sessions', async () => {
    const context = createContext();
    const signedIn = await signIn(context, await createVerifiedUser(context));

    await prisma.session.updateMany({ data: { revokedAt: new Date() } });

    await signedIn.agent.get(`${AUTH}/me`).expect(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session, clears the cookie, and is safe to retry', async () => {
    const context = createContext();
    const signedIn = await signIn(context, await createVerifiedUser(context));

    const response = await withCsrf(signedIn.agent.post(`${AUTH}/logout`), signedIn).expect(200);

    expect(response.body).toEqual({ success: true, data: { signedOut: true } });
    expect(String(response.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
    const session = await prisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();

    // The old cookie no longer works, and repeating the logout still succeeds.
    await request(context.app)
      .get(`${AUTH}/me`)
      .set('Cookie', cookieHeader(signedIn.cookieValue))
      .expect(401);
    await fromApp(request(context.app).post(`${AUTH}/logout`))
      .set('Cookie', cookieHeader(signedIn.cookieValue))
      .expect(200);
    await fromApp(request(context.app).post(`${AUTH}/logout`)).expect(200);
  });

  it('requires the CSRF token while the session is valid', async () => {
    const context = createContext();
    const signedIn = await signIn(context, await createVerifiedUser(context));

    const response = await fromApp(signedIn.agent.post(`${AUTH}/logout`)).expect(403);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('CSRF_TOKEN_INVALID');
    await signedIn.agent.get(`${AUTH}/me`).expect(200);
  });
});

describe('protected endpoints', () => {
  it('reject requests without a session', async () => {
    const context = createContext();
    const sessionId = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70';

    const attempts = [
      request(context.app).get(`${AUTH}/me`),
      request(context.app).get(`${AUTH}/sessions`),
      fromApp(request(context.app).patch(`${AUTH}/profile`)).send({ name: 'X' }),
      fromApp(request(context.app).post(`${AUTH}/password`)).send({}),
      fromApp(request(context.app).post(`${AUTH}/sessions/revoke-others`)),
      fromApp(request(context.app).delete(`${AUTH}/sessions/${sessionId}`)),
    ];

    for (const attempt of attempts) {
      const response = await attempt.set(CSRF_TOKEN_HEADER, 'A'.repeat(43));
      expect(response.status).toBe(401);
      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('UNAUTHORIZED');
    }
  });
});
