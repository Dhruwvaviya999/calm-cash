import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
  registrationDtoSchema,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  AUTH,
  createVerifiedUser,
  fromApp,
  newCredentials,
  register,
  sessionCookieValue,
  STRONG_PASSWORD,
  useIntegrationDatabase,
  verifyLatestLink,
} from '../../testing/integration-harness';
import { hashToken } from './tokens';

const { prisma, createContext } = useIntegrationDatabase();

function registrationBody(credentials: { name: string; email: string; password: string }): object {
  return { ...credentials, passwordConfirmation: credentials.password };
}

describe('POST /auth/register', () => {
  it('creates an unverified user, stores only an Argon2id hash, and e-mails a link', async () => {
    const context = createContext();
    const credentials = newCredentials({ email: '  New.Person@Example.COM ' });

    const response = await fromApp(request(context.app).post(`${AUTH}/register`))
      .send(registrationBody(credentials))
      .expect(202);

    const body = apiSuccessResponseSchema(registrationDtoSchema).parse(response.body);
    expect(body.data).toEqual({ email: 'new.person@example.com', verificationRequired: true });
    expect(sessionCookieValue(response)).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'new.person@example.com' },
    });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(user.passwordHash).not.toContain(STRONG_PASSWORD);

    const token = context.email.latestToken('new.person@example.com', 'email-verification');
    const [message] = context.email.messagesTo('new.person@example.com');
    expect(message?.text).toContain(`http://localhost:3000/verify-email?token=${token}`);

    const stored = await prisma.authToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toContain(token);
  });

  it('rejects invalid input with field-level details', async () => {
    const context = createContext();
    const response = await fromApp(request(context.app).post(`${AUTH}/register`))
      .send({ name: ' ', email: 'not-an-email', password: 'short', passwordConfirmation: 'x' })
      .expect(400);

    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((detail) => detail.path).sort()).toEqual([
      'body.email',
      'body.name',
      'body.password',
      'body.passwordConfirmation',
    ]);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects attempts to set privileged fields', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await fromApp(request(context.app).post(`${AUTH}/register`))
      .send({ ...registrationBody(credentials), emailVerifiedAt: new Date().toISOString() })
      .expect(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('answers a duplicate registration exactly like a new one, without changing the account', async () => {
    const context = createContext();
    const existing = await createVerifiedUser(context);
    const before = await prisma.user.findUniqueOrThrow({ where: { email: existing.email } });

    const fresh = await fromApp(request(context.app).post(`${AUTH}/register`))
      .send(registrationBody(newCredentials()))
      .expect(202);
    const duplicate = await fromApp(request(context.app).post(`${AUTH}/register`))
      .send(
        registrationBody({
          name: 'Someone Else',
          email: existing.email.toUpperCase(),
          password: 'another long passphrase',
        }),
      )
      .expect(202);

    const envelope = apiSuccessResponseSchema(registrationDtoSchema);
    expect(Object.keys(envelope.parse(duplicate.body).data)).toEqual(
      Object.keys(envelope.parse(fresh.body).data),
    );
    const after = await prisma.user.findUniqueOrThrow({ where: { email: existing.email } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.name).toBe(before.name);
    expect(context.email.messagesTo(existing.email).at(-1)?.template).toBe('existing-account');
  });

  it('lets the latest registration of an unverified address win and voids older links', async () => {
    const context = createContext();
    const squatter = newCredentials({ password: 'squatter passphrase 1' });
    await register(context, squatter);
    const squatterToken = context.email.latestToken(squatter.email, 'email-verification');

    await register(context, { ...squatter, name: 'Real Owner', password: STRONG_PASSWORD });

    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token: squatterToken })
      .expect(400);
    await verifyLatestLink(context, squatter.email);

    await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: squatter.email, password: 'squatter passphrase 1' })
      .expect(401);
    await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: squatter.email, password: STRONG_PASSWORD })
      .expect(200);
  });

  it('reports an e-mail outage instead of pretending the message was sent', async () => {
    const context = createContext();
    context.email.failing = true;

    const response = await fromApp(request(context.app).post(`${AUTH}/register`))
      .send(registrationBody(newCredentials()))
      .expect(503);

    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('EMAIL_DELIVERY_FAILED');
  });
});

describe('unverified accounts', () => {
  it('cannot sign in or reach protected endpoints', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await register(context, credentials);

    const login = await fromApp(request(context.app).post(`${AUTH}/login`))
      .send({ email: credentials.email, password: credentials.password })
      .expect(403);

    expect(apiErrorResponseSchema.parse(login.body).error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sessionCookieValue(login)).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('POST /auth/verify-email', () => {
  it('verifies the address once and rejects the link afterwards', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await register(context, credentials);
    const token = context.email.latestToken(credentials.email, 'email-verification');

    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const reused = await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token })
      .expect(400);
    expect(apiErrorResponseSchema.parse(reused.body).error.code).toBe('INVALID_TOKEN');
  });

  it('rejects expired links', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await register(context, credentials);
    const token = context.email.latestToken(credentials.email, 'email-verification');

    context.clock.advance(EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000 + 1);

    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token })
      .expect(400);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('lets exactly one of several concurrent requests consume a link', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await register(context, credentials);
    const token = context.email.latestToken(credentials.email, 'email-verification');

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        fromApp(request(context.app).post(`${AUTH}/verify-email`)).send({ token }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400, 400, 400, 400, 400,
    ]);
  });

  it('rejects malformed and unknown tokens', async () => {
    const context = createContext();
    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token: 'not-a-token' })
      .expect(400);
    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token: 'A'.repeat(43) })
      .expect(400);
  });
});

describe('POST /auth/verify-email/resend', () => {
  it('answers identically for unknown, pending, and verified addresses', async () => {
    const context = createContext();
    const pending = newCredentials();
    await register(context, pending);
    const verified = await createVerifiedUser(context);
    const sentBefore = context.email.outbox.length;

    const responses = await Promise.all(
      [pending.email, verified.email, 'nobody@example.com'].map((email) =>
        fromApp(request(context.app).post(`${AUTH}/verify-email/resend`)).send({ email }),
      ),
    );
    await context.tasks.drain();

    for (const response of responses) {
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ success: true, data: { accepted: true } });
    }
    // Only the pending registration receives a new link.
    expect(context.email.outbox.slice(sentBefore).map((message) => message.to)).toEqual([
      pending.email,
    ]);
  });

  it('replaces the previous link', async () => {
    const context = createContext();
    const credentials = newCredentials();
    await register(context, credentials);
    const first = context.email.latestToken(credentials.email, 'email-verification');

    await fromApp(request(context.app).post(`${AUTH}/verify-email/resend`))
      .send({ email: credentials.email })
      .expect(202);
    await context.tasks.drain();
    const second = context.email.latestToken(credentials.email, 'email-verification');

    expect(second).not.toBe(first);
    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token: first })
      .expect(400);
    await fromApp(request(context.app).post(`${AUTH}/verify-email`))
      .send({ token: second })
      .expect(200);
  });
});
