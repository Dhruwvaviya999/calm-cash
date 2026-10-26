import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  authSessionDtoSchema,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  userDtoSchema,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  AUTH,
  cookieHeader,
  createVerifiedUser,
  fromApp,
  newCredentials,
  register,
  sessionCookieValue,
  signIn,
  STRONG_PASSWORD,
  useIntegrationDatabase,
  withCsrf,
} from '../../testing/integration-harness';
import { hashToken } from './tokens';

const { prisma, createContext } = useIntegrationDatabase();

const NEW_PASSWORD = 'a completely different passphrase';

describe('PATCH /auth/profile', () => {
  it('updates only the signed-in user', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context, { name: 'Alice' }));
    const bob = await createVerifiedUser(context, { name: 'Bob' });

    const response = await withCsrf(alice.agent.patch(`${AUTH}/profile`), alice)
      .send({ name: '  Alice Rao ', preferredCurrency: 'USD', timezone: 'America/New_York' })
      .expect(200);

    const updated = apiSuccessResponseSchema(userDtoSchema).parse(response.body).data;
    expect(updated).toMatchObject({
      id: alice.session.user.id,
      name: 'Alice Rao',
      preferredCurrency: 'USD',
      timezone: 'America/New_York',
    });
    const bobRow = await prisma.user.findUniqueOrThrow({ where: { email: bob.email } });
    expect(bobRow).toMatchObject({
      name: 'Bob',
      preferredCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });

    // The current-session endpoint reflects the persisted change.
    const me = await alice.agent.get(`${AUTH}/me`).expect(200);
    expect(apiSuccessResponseSchema(authSessionDtoSchema).parse(me.body).data.user.name).toBe(
      'Alice Rao',
    );
  });

  it('refuses protected fields and identifiers supplied by the client', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));
    const bob = await createVerifiedUser(context);
    const bobRow = await prisma.user.findUniqueOrThrow({ where: { email: bob.email } });

    for (const extra of [
      { email: 'new@example.com' },
      { id: bobRow.id },
      { userId: bobRow.id },
      { passwordHash: '$argon2id$v=19$m=1,t=1,p=1$x$y' },
      { emailVerifiedAt: null },
    ]) {
      const response = await withCsrf(alice.agent.patch(`${AUTH}/profile`), alice)
        .send({ name: 'Mallory', ...extra })
        .expect(400);
      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    }

    const aliceRow = await prisma.user.findUniqueOrThrow({ where: { id: alice.session.user.id } });
    expect(aliceRow.name).toBe(alice.session.user.name);
    expect(aliceRow.email).toBe(alice.session.user.email);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: bobRow.id } })).toEqual(bobRow);
  });

  it('validates currencies and time zones', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));

    await withCsrf(alice.agent.patch(`${AUTH}/profile`), alice)
      .send({ preferredCurrency: 'XYZ' })
      .expect(400);
    await withCsrf(alice.agent.patch(`${AUTH}/profile`), alice)
      .send({ timezone: 'Mars/Olympus_Mons' })
      .expect(400);
    await withCsrf(alice.agent.patch(`${AUTH}/profile`), alice)
      .send({})
      .expect(400);
  });
});

describe('POST /auth/password', () => {
  it('requires the correct current password', async () => {
    const context = createContext();
    const alice = await signIn(context, await createVerifiedUser(context));

    const response = await withCsrf(alice.agent.post(`${AUTH}/password`), alice)
      .send({
        currentPassword: 'definitely not it at all',
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      })
      .expect(400);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.details?.[0]?.path).toBe('body.currentPassword');
    await alice.agent.get(`${AUTH}/me`).expect(200);
  });

  it('changes the password, rotates this session, and signs out every other session', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const laptop = await signIn(context, credentials);
    const phone = await signIn(context, credentials);
    const before = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });

    const response = await withCsrf(laptop.agent.post(`${AUTH}/password`), laptop)
      .send({
        currentPassword: credentials.password,
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      })
      .expect(200);

    const body = apiSuccessResponseSchema(authSessionDtoSchema).parse(response.body).data;
    expect(JSON.stringify(response.body)).not.toContain(NEW_PASSWORD);
    expect(body.csrfToken).not.toBe(laptop.session.csrfToken);
    const rotatedCookie = sessionCookieValue(response);
    expect(rotatedCookie).toBeDefined();
    expect(rotatedCookie).not.toBe(laptop.cookieValue);

    const after = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);

    // The agent now holds the rotated cookie; the old laptop cookie and the phone are signed out.
    await laptop.agent.get(`${AUTH}/me`).expect(200);
    await request(context.app)
      .get(`${AUTH}/me`)
      .set('Cookie', cookieHeader(laptop.cookieValue))
      .expect(401);
    await phone.agent.get(`${AUTH}/me`).expect(401);

    await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: credentials.email, password: credentials.password })
      .expect(401);
    await signIn(context, { email: credentials.email, password: NEW_PASSWORD });

    await context.tasks.drain();
    expect(context.email.messagesTo(credentials.email).at(-1)?.template).toBe('password-changed');
  });

  it('rejects a weak or mismatched new password', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const alice = await signIn(context, credentials);

    await withCsrf(alice.agent.post(`${AUTH}/password`), alice)
      .send({
        currentPassword: credentials.password,
        newPassword: 'password1234',
        newPasswordConfirmation: 'password1234',
      })
      .expect(400);
    await withCsrf(alice.agent.post(`${AUTH}/password`), alice)
      .send({
        currentPassword: credentials.password,
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: `${NEW_PASSWORD}!`,
      })
      .expect(400);
  });
});

describe('password recovery', () => {
  async function requestReset(
    context: ReturnType<typeof createContext>,
    email: string,
  ): Promise<request.Response> {
    const response = await fromApp(request(context.app).post(`${AUTH}/forgot-password`)).send({
      email,
    });
    await context.tasks.drain();
    return response;
  }

  it('answers identically whether or not the address has an account', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const sentBefore = context.email.outbox.length;

    const known = await requestReset(context, credentials.email.toUpperCase());
    const unknown = await requestReset(context, 'nobody@example.com');

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(context.email.outbox.slice(sentBefore).map((message) => message.to)).toEqual([
      credentials.email,
    ]);

    const token = context.email.latestToken(credentials.email, 'password-reset');
    const stored = await prisma.authToken.findMany({ where: { purpose: 'password_reset' } });
    expect(stored.map((row) => row.tokenHash)).toEqual([hashToken(token)]);
  });

  it('resets the password once, revokes every session, and rejects reuse', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    const signedIn = await signIn(context, credentials);
    await requestReset(context, credentials.email);
    const token = context.email.latestToken(credentials.email, 'password-reset');

    await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .expect(200);

    await signedIn.agent.get(`${AUTH}/me`).expect(401);
    await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: credentials.email, password: credentials.password })
      .expect(401);
    await signIn(context, { email: credentials.email, password: NEW_PASSWORD });

    const reused = await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send({ token, password: STRONG_PASSWORD, passwordConfirmation: STRONG_PASSWORD })
      .expect(400);
    expect(apiErrorResponseSchema.parse(reused.body).error.code).toBe('INVALID_TOKEN');
  });

  it('rejects expired reset links', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    await requestReset(context, credentials.email);
    const token = context.email.latestToken(credentials.email, 'password-reset');

    context.clock.advance(PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000 + 1);

    await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .expect(400);
    await signIn(context, credentials);
  });

  it('only honours the newest reset link', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    await requestReset(context, credentials.email);
    const first = context.email.latestToken(credentials.email, 'password-reset');
    await requestReset(context, credentials.email);

    await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send({ token: first, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .expect(400);
  });

  it('lets exactly one of several concurrent submissions use a link', async () => {
    const context = createContext();
    const credentials = await createVerifiedUser(context);
    await requestReset(context, credentials.email);
    const token = context.email.latestToken(credentials.email, 'password-reset');

    const passwords = Array.from({ length: 5 }, (_, index) => `${NEW_PASSWORD} number ${index}`);
    const responses = await Promise.all(
      passwords.map((password) =>
        fromApp(request(context.app).post(`${AUTH}/reset-password`)).send({
          token,
          password,
          passwordConfirmation: password,
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(4);
  });

  it('verifies a pending address, since the link proves ownership', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await register(context, credentials);
    await requestReset(context, credentials.email);
    const token = context.email.latestToken(credentials.email, 'password-reset');

    await fromApp(request(context.app).post(`${AUTH}/reset-password`))
      .send({ token, password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .expect(200);

    await signIn(context, { email: credentials.email, password: NEW_PASSWORD });
  });
});
