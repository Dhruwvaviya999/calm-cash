import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  CSRF_TOKEN_HEADER,
  revokedSessionsDtoSchema,
  sessionListDtoSchema,
} from '@calmcash/shared';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { TEST_SESSION_CONFIG } from '../../testing/create-test-app';
import {
  AUTH,
  createVerifiedUser,
  fromApp,
  SESSION_COOKIE,
  signIn,
  useIntegrationDatabase,
  withCsrf,
} from '../../testing/integration-harness';
import { CLEANUP_RETENTION_MS, cleanUpStaleAuthRecords } from './session-cleanup';

const { prisma, createContext } = useIntegrationDatabase();

const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0';

describe('CSRF protection', () => {
  it('rejects state-changing requests without the session token', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));
    const otherSession = await signIn(context, await createVerifiedUser(context));

    const attempts: [string, string | undefined][] = [
      ['missing', undefined],
      ['malformed', 'not-a-token'],
      ['forged', 'A'.repeat(43)],
      ["another session's", otherSession.session.csrfToken],
    ];
    for (const [, token] of attempts) {
      const test = fromApp(alice.agent.patch(`${AUTH}/profile`));
      const response = await (token === undefined ? test : test.set(CSRF_TOKEN_HEADER, token))
        .send({ name: 'Changed by CSRF' })
        .expect(403);
      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('CSRF_TOKEN_INVALID');
    }

    const row = await prisma.user.findUniqueOrThrow({ where: { id: alice.session.user.id } });
    expect(row.name).toBe(alice.session.user.name);

    await withCsrf(alice.agent.patch(`${AUTH}/profile`), alice)
      .send({ name: 'Changed legitimately' })
      .expect(200);
  });

  it('protects session revocation and password changes too', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));

    await fromApp(alice.agent.post(`${AUTH}/sessions/revoke-others`)).expect(403);
    await fromApp(alice.agent.delete(`${AUTH}/sessions/${alice.session.sessionId}`)).expect(403);
    await fromApp(alice.agent.post(`${AUTH}/password`))
      .send({})
      .expect(403);
  });
});

describe('origin verification', () => {
  it('rejects state-changing requests from other sites, before any work is done', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);

    const foreign = await request(context.app)
      .post(`${AUTH}/login`)
      .set('Origin', 'https://evil.example')
      .send({ email: credentials.email, password: credentials.password })
      .expect(403);
    expect(apiErrorResponseSchema.parse(foreign.body).error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(foreign.headers['set-cookie']).toBeUndefined();

    await request(context.app)
      .post(`${AUTH}/register`)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ ...credentials, passwordConfirmation: credentials.password })
      .expect(403);
    await request(context.app)
      .post(`${AUTH}/forgot-password`)
      .set('Origin', 'null')
      .send({ email: credentials.email })
      .expect(403);

    expect(await prisma.session.count()).toBe(0);
  });
});

describe('rate limiting', () => {
  it('limits failed sign-ins per normalised e-mail address across spellings', async () => {
    const context = createContext({
      rateLimits: { loginPerEmail: { limit: 3, windowMs: 60_000 } },
    });
    const credentials = await createVerifiedUser(context);

    for (const email of [
      credentials.email,
      credentials.email.toUpperCase(),
      ` ${credentials.email}`,
    ]) {
      await fromApp(request(context.app).post(`${AUTH}/login`))
        .send({ email, password: 'wrong passphrase here' })
        .expect(401);
    }
    const limited = await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: credentials.email, password: credentials.password })
      .expect(429);

    expect(apiErrorResponseSchema.parse(limited.body).error.code).toBe('RATE_LIMITED');
    expect(limited.get('Retry-After')).toBe('60');
    // Other addresses are unaffected.
    const other = await createVerifiedUser(context);
    await signIn(context, other);
  });

  it('does not count successful sign-ins', async () => {
    const context = createContext({
      rateLimits: { loginPerEmail: { limit: 2, windowMs: 60_000 } },
    });
    const credentials = await createVerifiedUser(context);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await signIn(context, credentials);
    }
  });

  it('limits password-reset requests per address', async () => {
    const context = createContext({
      rateLimits: { forgotPasswordPerEmail: { limit: 2, windowMs: 60_000 } },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await fromApp(request(context.app).post(`${AUTH}/forgot-password`))
        .send({ email: 'someone@example.com' })
        .expect(202);
    }
    await fromApp(request(context.app).post(`${AUTH}/forgot-password`))
      .send({ email: 'SOMEONE@example.com' })
      .expect(429);
    await context.tasks.drain();
  });

  it('limits registrations, verification attempts, and reset submissions per client', async () => {
    const context = createContext({
      rateLimits: {
        registerPerIp: { limit: 1, windowMs: 60_000 },
        verifyEmailPerIp: { limit: 1, windowMs: 60_000 },
        resetPasswordPerIp: { limit: 1, windowMs: 60_000 },
      },
    });
    const token = { token: 'A'.repeat(43) };

    await fromApp(request(context.app).post(`${AUTH}/register`))
      .send({})
      .expect(400);
    await fromApp(request(context.app).post(`${AUTH}/register`))
      .send({})
      .expect(429);
    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send(token)
      .expect(400);
    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send(token)
      .expect(429);
    await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send(token)
      .expect(400);
    await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send(token)
      .expect(429);
  });
});

describe('session management', () => {
  it('lists only the caller’s active sessions, marks the current one, and exposes no secrets', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const laptop = await signIn(context, credentials);
    const phone = await signIn(context, credentials, FIREFOX_ANDROID);
    await signIn(context, await createVerifiedUser(context));
    await withCsrf(phone.agent.post(`${AUTH}/logout`), phone).expect(200);
    const tablet = await signIn(context, credentials, FIREFOX_ANDROID);

    const response = await laptop.agent.get(`${AUTH}/sessions`).expect(200);

    const { sessions } = apiSuccessResponseSchema(sessionListDtoSchema).parse(response.body).data;
    expect(sessions.map((session) => session.id).sort()).toEqual(
      [laptop.session.sessionId, tablet.session.sessionId].sort(),
    );
    expect(sessions.find((session) => session.current)?.id).toBe(laptop.session.sessionId);
    expect(sessions.find((session) => !session.current)?.deviceLabel).toBe('Firefox on Android');
    expect(JSON.stringify(response.body)).not.toMatch(/tokenHash|csrfTokenHash|userId/);
    expect(JSON.stringify(response.body)).not.toContain(laptop.cookieValue);
  });

  it('revokes a selected session of the caller', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const laptop = await signIn(context, credentials);
    const phone = await signIn(context, credentials);

    const response = await withCsrf(
      laptop.agent.delete(`${AUTH}/sessions/${phone.session.sessionId}`),
      laptop,
    ).expect(200);

    expect(apiSuccessResponseSchema(revokedSessionsDtoSchema).parse(response.body).data).toEqual({
      revokedCount: 1,
    });
    await phone.agent.get(`${AUTH}/me`).expect(401);
    await laptop.agent.get(`${AUTH}/me`).expect(200);
  });

  it('clears the cookie when the caller revokes their own session', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));

    const response = await withCsrf(
      alice.agent.delete(`${AUTH}/sessions/${alice.session.sessionId}`),
      alice,
    ).expect(200);

    expect(String(response.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
    await alice.agent.get(`${AUTH}/me`).expect(401);
  });

  it('never lets one user revoke another user’s session', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));
    const mallory = await signIn(context, await createVerifiedUser(context));

    const response = await withCsrf(
      mallory.agent.delete(`${AUTH}/sessions/${alice.session.sessionId}`),
      mallory,
    ).expect(404);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
    await alice.agent.get(`${AUTH}/me`).expect(200);

    const unknown = await withCsrf(
      mallory.agent.delete(`${AUTH}/sessions/01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70`),
      mallory,
    ).expect(404);
    expect(apiErrorResponseSchema.parse(unknown.body).error.message).toBe(
      apiErrorResponseSchema.parse(response.body).error.message,
    );

    await withCsrf(mallory.agent.delete(`${AUTH}/sessions/not-a-uuid`), mallory).expect(400);
  });

  it('revokes all other sessions on request', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const laptop = await signIn(context, credentials);
    const phone = await signIn(context, credentials);
    const tablet = await signIn(context, credentials);
    const bob = await signIn(context, await createVerifiedUser(context));

    const response = await withCsrf(
      laptop.agent.post(`${AUTH}/sessions/revoke-others`),
      laptop,
    ).expect(200);

    expect(apiSuccessResponseSchema(revokedSessionsDtoSchema).parse(response.body).data).toEqual({
      revokedCount: 2,
    });
    await laptop.agent.get(`${AUTH}/me`).expect(200);
    await phone.agent.get(`${AUTH}/me`).expect(401);
    await tablet.agent.get(`${AUTH}/me`).expect(401);
    await bob.agent.get(`${AUTH}/me`).expect(200);
  });
});

describe('stale record cleanup', () => {
  it('deletes long-ended sessions and tokens but never a usable session', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const active = await signIn(context, credentials);
    const ended = await signIn(context, credentials);
    await withCsrf(ended.agent.post(`${AUTH}/logout`), ended).expect(200);

    // Shortly after the logout, nothing is old enough to delete.
    const early = await cleanUpStaleAuthRecords({
      repository: context.repository,
      session: TEST_SESSION_CONFIG,
      logger: pino({ level: 'silent' }),
      now: context.clock.now,
    });
    expect(early).toEqual({ sessions: 0, tokens: 0 });

    // Keep the active session in use while time passes beyond the retention period.
    const step = TEST_SESSION_CONFIG.idleTimeoutMs / 2;
    for (let elapsed = 0; elapsed <= CLEANUP_RETENTION_MS; elapsed += step) {
      context.clock.advance(step);
      await active.agent.get(`${AUTH}/me`).expect(200);
    }

    const result = await cleanUpStaleAuthRecords({
      repository: context.repository,
      session: TEST_SESSION_CONFIG,
      logger: pino({ level: 'silent' }),
      now: context.clock.now,
    });

    expect(result).toEqual({ sessions: 1, tokens: 1 });
    const remaining = await prisma.session.findMany();
    expect(remaining.map((session) => session.id)).toEqual([active.session.sessionId]);
    await active.agent.get(`${AUTH}/me`).expect(200);
  });
});
