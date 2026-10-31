import {
  apiSuccessResponseSchema,
  notificationDtoSchema,
  notificationPageDtoSchema,
  notificationPreferencesDtoSchema,
  notificationsUpdatedDtoSchema,
  type NotificationPageDto,
  type NotificationPreferencesDto,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createNotificationWriter } from '../../automation/notification-writer';
import { NOTIFICATIONS } from '../../testing/automation-helpers';
import { newUser, parseError } from '../../testing/finance-helpers';
import {
  fromApp,
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
} from '../../testing/integration-harness';

const { prisma, createContext } = useIntegrationDatabase();

const pageEnvelope = apiSuccessResponseSchema(notificationPageDtoSchema);
const updatedEnvelope = apiSuccessResponseSchema(notificationsUpdatedDtoSchema);
const preferencesEnvelope = apiSuccessResponseSchema(notificationPreferencesDtoSchema);

/** Creates notifications for a user the way the worker does, one second apart. */
async function seedNotifications(user: SignedIn, count: number, start = Date.now()): Promise<void> {
  const writer = createNotificationWriter(prisma);
  for (let index = 0; index < count; index += 1) {
    await writer.write(
      {
        userId: user.session.user.id,
        type: 'recurring_payment_upcoming',
        dedupeKey: `test:${index.toString()}`,
        title: `Bill ${index.toString()} is due in 3 days`,
        body: '<script>alert(1)</script> stays plain text',
        target: undefined,
        channels: { inApp: true, email: false },
        emailExpiresAt: undefined,
      },
      true,
      new Date(start + index * 1_000),
    );
  }
}

async function page(user: SignedIn, query = ''): Promise<NotificationPageDto> {
  const response = await user.agent.get(`${NOTIFICATIONS}${query}`).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return pageEnvelope.parse(response.body).data;
}

async function preferences(user: SignedIn): Promise<NotificationPreferencesDto> {
  return preferencesEnvelope.parse(
    (await user.agent.get(`${NOTIFICATIONS}/preferences`).expect(200)).body,
  ).data;
}

describe('notification center API', () => {
  it('lists newest first with pagination, an unread filter, and plain-text content', async () => {
    const context = createContext();
    const user = await newUser(context);
    await seedNotifications(user, 25);

    const first = await page(user, '?pageSize=10');
    expect(first.pagination).toEqual({ page: 1, pageSize: 10, totalItems: 25, totalPages: 3 });
    expect(first.unreadCount).toBe(25);
    expect(first.items.map((item) => item.title)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Bill ${(24 - index).toString()} is due in 3 days`),
    );
    expect(first.items[0]).toMatchObject({
      type: 'recurring_payment_upcoming',
      category: 'upcoming_payments',
      // Stored and returned as text; the web app renders it as text, never as markup.
      body: '<script>alert(1)</script> stays plain text',
    });
    expect(first.items[0]?.readAt).toBeUndefined();
    const third = await page(user, '?pageSize=10&page=3');
    expect(third.items).toHaveLength(5);
    // The default page size is bounded, and so is the largest one.
    expect((await page(user)).items).toHaveLength(20);
    const tooLarge = await user.agent.get(`${NOTIFICATIONS}?pageSize=500`).expect(400);
    expect(parseError(tooLarge.body).code).toBe('VALIDATION_ERROR');
  });

  it('marks one, several, and all notifications read, and dismisses one', async () => {
    const context = createContext();
    const user = await newUser(context);
    await seedNotifications(user, 5);
    const [a, b, c] = (await page(user)).items;
    if (a === undefined || b === undefined || c === undefined) throw new Error('Seed failed.');

    const read = apiSuccessResponseSchema(notificationDtoSchema).parse(
      (await withCsrf(user.agent.post(`${NOTIFICATIONS}/${a.id}/read`), user).expect(200)).body,
    ).data;
    expect(read.readAt).toBeDefined();
    // Idempotent.
    await withCsrf(user.agent.post(`${NOTIFICATIONS}/${a.id}/read`), user).expect(200);

    const many = updatedEnvelope.parse(
      (
        await withCsrf(user.agent.post(`${NOTIFICATIONS}/read`), user)
          .send({ ids: [a.id, b.id, c.id] })
          .expect(200)
      ).body,
    ).data;
    expect(many).toEqual({ updatedCount: 2, unreadCount: 2 });
    expect((await page(user, '?status=unread')).items).toHaveLength(2);

    const dismissed = updatedEnvelope.parse(
      (await withCsrf(user.agent.post(`${NOTIFICATIONS}/${c.id}/dismiss`), user).expect(200)).body,
    ).data;
    expect(dismissed.unreadCount).toBe(2);
    expect((await page(user)).items.map((item) => item.id)).not.toContain(c.id);
    // Dismissed notifications are hidden, not deleted (their identity still prevents repeats).
    expect(await prisma.notification.count({ where: { id: c.id } })).toBe(1);

    const all = updatedEnvelope.parse(
      (await withCsrf(user.agent.post(`${NOTIFICATIONS}/read-all`), user).expect(200)).body,
    ).data;
    expect(all).toEqual({ updatedCount: 2, unreadCount: 0 });
    const count = await user.agent.get(`${NOTIFICATIONS}/unread-count`).expect(200);
    expect(count.body).toEqual({ success: true, data: { unreadCount: 0 } });
  });

  it('keeps every notification private to its owner', async () => {
    const context = createContext();
    const owner = await newUser(context);
    const intruder = await newUser(context);
    await seedNotifications(owner, 2);
    const [target] = (await page(owner)).items;
    if (target === undefined) throw new Error('Seed failed.');

    expect((await page(intruder)).items).toEqual([]);
    for (const action of ['read', 'dismiss']) {
      const response = await withCsrf(
        intruder.agent.post(`${NOTIFICATIONS}/${target.id}/${action}`),
        intruder,
      ).expect(404);
      expect(parseError(response.body).code).toBe('NOT_FOUND');
    }
    const bulk = updatedEnvelope.parse(
      (
        await withCsrf(intruder.agent.post(`${NOTIFICATIONS}/read`), intruder)
          .send({ ids: [target.id] })
          .expect(200)
      ).body,
    ).data;
    expect(bulk.updatedCount).toBe(0);
    await withCsrf(intruder.agent.post(`${NOTIFICATIONS}/read-all`), intruder).expect(200);
    expect((await page(owner)).unreadCount).toBe(2);

    // A user ID in a request is never an owner: unknown fields are refused.
    const smuggled = await withCsrf(intruder.agent.patch(`${NOTIFICATIONS}/preferences`), intruder)
      .send({ userId: owner.session.user.id, paymentLeadDays: 7 })
      .expect(400);
    expect(parseError(smuggled.body).code).toBe('VALIDATION_ERROR');
    expect((await preferences(owner)).paymentLeadDays).toBe(3);
  });

  it('requires a session for reads and the CSRF token for changes', async () => {
    const context = createContext();
    const user = await newUser(context);
    await seedNotifications(user, 1);
    const [item] = (await page(user)).items;
    if (item === undefined) throw new Error('Seed failed.');

    for (const path of ['', '/unread-count', '/preferences']) {
      const signedOut = await fromApp(request(context.app).get(`${NOTIFICATIONS}${path}`));
      expect(signedOut.status).toBe(401);
    }
    const noCsrf = await fromApp(user.agent.post(`${NOTIFICATIONS}/${item.id}/read`));
    expect(noCsrf.status).toBe(403);
    expect(parseError(noCsrf.body).code).toBe('CSRF_TOKEN_INVALID');
    const badId = await withCsrf(user.agent.post(`${NOTIFICATIONS}/not-a-uuid/read`), user);
    expect(badId.status).toBe(400);
  });
});

describe('notification preferences API', () => {
  it('starts from the documented defaults and saves partial changes', async () => {
    const context = createContext();
    const user = await newUser(context);
    const defaults = await preferences(user);
    expect(defaults).toMatchObject({
      channels: {
        budget_alerts: { inApp: true, email: false },
        upcoming_payments: { inApp: true, email: false },
        overdue_payments: { inApp: true, email: false },
        subscription_renewals: { inApp: true, email: false },
        monthly_summary: { inApp: true, email: false },
      },
      paymentLeadDays: 3,
      subscriptionLeadDays: 3,
      includeRecurringIncome: false,
      email: { address: user.session.user.email, verified: true },
      // No worker has run against this database in this test.
      automation: { status: 'not_running' },
    });
    expect(defaults.updatedAt).toBeUndefined();

    const saved = preferencesEnvelope.parse(
      (
        await withCsrf(user.agent.patch(`${NOTIFICATIONS}/preferences`), user)
          .send({
            channels: { monthly_summary: { email: true }, budget_alerts: { inApp: false } },
            subscriptionLeadDays: 7,
          })
          .expect(200)
      ).body,
    ).data;
    expect(saved.channels.monthly_summary).toEqual({ inApp: true, email: true });
    // Turning in-app off never turns another channel on.
    expect(saved.channels.budget_alerts).toEqual({ inApp: false, email: false });
    expect(saved.subscriptionLeadDays).toBe(7);
    expect(saved.paymentLeadDays).toBe(3);
    expect(saved.updatedAt).toBeDefined();
    expect(await preferences(user)).toEqual(saved);
  });

  it('rejects lead times and categories that do not exist', async () => {
    const context = createContext();
    const user = await newUser(context);
    for (const body of [
      { paymentLeadDays: 2 },
      { subscriptionLeadDays: 365 },
      { channels: { sms: { inApp: true } } },
      { channels: { budget_alerts: { push: true } } },
      {},
    ]) {
      const response = await withCsrf(user.agent.patch(`${NOTIFICATIONS}/preferences`), user)
        .send(body)
        .expect(400);
      expect(parseError(response.body).code).toBe('VALIDATION_ERROR');
    }
  });

  it('reports a running worker from its recent heartbeat', async () => {
    const context = createContext();
    const user = await newUser(context);
    await prisma.workerHeartbeat.create({
      data: { id: 'test-worker', startedAt: context.clock.now(), lastSeenAt: context.clock.now() },
    });
    expect((await preferences(user)).automation.status).toBe('running');
    context.clock.advance(10 * 60_000);
    expect((await preferences(user)).automation).toMatchObject({ status: 'not_running' });
  });
});
