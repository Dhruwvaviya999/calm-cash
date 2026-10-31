import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  recurringScheduleItemDtoSchema,
  subscriptionDtoSchema,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  createTestWorker,
  drain,
  notificationsOf,
  queueReview,
  setPreferences,
} from '../testing/automation-helpers';
import { balanceOf, categoryId, createAccount, newUser } from '../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../testing/integration-harness';

// Recurring-payment and subscription reminders end to end: schedules created through the real
// API, the daily review queued by the real scheduler, and reminders read back from the database.

const RECURRING = `${API_V1_PREFIX}/recurring`;
const SUBSCRIPTIONS = `${API_V1_PREFIX}/subscriptions`;
const TIME_ZONE = 'Asia/Kolkata';

const { prisma, createContext } = useIntegrationDatabase();

interface Seeded {
  context: TestContext;
  user: SignedIn;
  today: string;
  bank: string;
  bills: string;
  salary: string;
}

async function seed(): Promise<Seeded> {
  const context = createContext();
  const user = await newUser(context);
  const today = calendarDateInTimeZone(context.clock.now(), TIME_ZONE);
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '10000000',
      openingBalanceDate: addMonthsToIsoDate(today, -6),
    })
  ).account.id;
  return {
    context,
    user,
    today,
    bank,
    bills: await categoryId(user, 'expense', 'Utilities'),
    salary: await categoryId(user, 'income', 'Salary'),
  };
}

async function schedule(
  seeded: Seeded,
  name: string,
  startDate: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await withCsrf(seeded.user.agent.post(RECURRING), seeded.user).send({
    name,
    type: 'expense',
    amountMinor: '250000',
    accountId: seeded.bank,
    categoryId: overrides.type === 'income' ? seeded.salary : seeded.bills,
    frequency: 'monthly',
    startDate,
    ...overrides,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return apiSuccessResponseSchema(recurringScheduleItemDtoSchema).parse(response.body).data.schedule
    .id;
}

async function subscribe(seeded: Seeded, name: string, startDate: string): Promise<string> {
  const response = await withCsrf(seeded.user.agent.post(SUBSCRIPTIONS), seeded.user).send({
    name,
    amountMinor: '64900',
    accountId: seeded.bank,
    frequency: 'monthly',
    startDate,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return apiSuccessResponseSchema(subscriptionDtoSchema).parse(response.body).data.schedule.id;
}

function occurrence(scheduleId: string, date: string, action: string): string {
  return `${RECURRING}/${scheduleId}/occurrences/${date}/${action}`;
}

function worker(
  seeded: Seeded,
  now = seeded.context.clock.now,
): ReturnType<typeof createTestWorker> {
  return createTestWorker(prisma, { email: seeded.context.email, now });
}

async function reminders(seeded: Seeded): Promise<string[]> {
  return (await notificationsOf(prisma, seeded.user))
    .filter((row) => row.type !== 'budget_approaching_limit' && row.type !== 'budget_limit_reached')
    .map((row) => `${row.type} | ${row.title}`)
    .sort();
}

describe('recurring payment and subscription reminders', () => {
  it('reminds about pending occurrences only, at the chosen lead time, exactly once', async () => {
    const seeded = await seed();
    const { user, today } = seeded;
    const day = (offset: number): string => addDaysToIsoDate(today, offset);

    await schedule(seeded, 'Rent', day(3));
    await schedule(seeded, 'Internet', day(4)); // beyond the 3-day lead time
    await schedule(seeded, 'Phone', day(0));
    await schedule(seeded, 'Insurance', day(-2));
    await schedule(seeded, 'Gym', day(-20)); // overdue for more than a week: left alone
    await schedule(seeded, 'Salary', day(1), { type: 'income' }); // income is opt-in
    const skipped = await schedule(seeded, 'Parking', day(2));
    const recorded = await schedule(seeded, 'Water', day(2));
    const paused = await schedule(seeded, 'Cleaner', day(1));
    await subscribe(seeded, 'Netflix', day(3));
    // Started last month, renews in 2 days — but cancelled today.
    const cancelled = await subscribe(seeded, 'Music', addMonthsToIsoDate(day(2), -1));

    await withCsrf(user.agent.post(occurrence(skipped, day(2), 'skip')), user).expect(200);
    await withCsrf(user.agent.post(occurrence(recorded, day(2), 'record')), user)
      .send({})
      .expect(201);
    await withCsrf(user.agent.post(`${RECURRING}/${paused}/pause`), user).expect(200);
    await withCsrf(user.agent.post(`${SUBSCRIPTIONS}/${cancelled}/cancel`), user)
      .send({})
      .expect(200);
    const transactions = await prisma.transaction.count({
      where: { userId: user.session.user.id },
    });
    const balance = await balanceOf(user, seeded.bank);

    await drain(worker(seeded));
    expect(await reminders(seeded)).toEqual([
      'recurring_payment_due | Phone is due today',
      'recurring_payment_overdue | Insurance is overdue',
      'recurring_payment_upcoming | Rent is due in 3 days',
      'subscription_renewal_upcoming | Netflix renews in 3 days',
    ]);
    const rent = (await notificationsOf(prisma, user)).find((row) => row.title.startsWith('Rent'));
    expect(rent?.body).toContain('₹2,500.00 is expected on');
    expect(rent?.body).toContain('nothing has been paid or recorded');
    const netflix = (await notificationsOf(prisma, user)).find((row) =>
      row.title.startsWith('Netflix'),
    );
    expect(netflix?.body).toContain('Expected charge: ₹649.00');
    expect(netflix?.body).toContain('not a charge that has happened');
    expect(netflix?.target).toMatchObject({ kind: 'subscription', dueDate: day(3) });

    // Another review the same day (another worker, a restart): nothing new.
    await queueReview(prisma, user, today, seeded.context.clock.now(), 'again');
    await drain(worker(seeded));
    expect(await reminders(seeded)).toHaveLength(4);

    // Reminders never record money.
    expect(await prisma.transaction.count({ where: { userId: user.session.user.id } })).toBe(
      transactions,
    );
    expect(await balanceOf(user, seeded.bank)).toBe(balance);
  });

  it('follows the person’s lead time, income choice, and categories', async () => {
    const seeded = await seed();
    const { user, today } = seeded;
    await setPreferences(user, {
      paymentLeadDays: 1,
      includeRecurringIncome: true,
      channels: { overdue_payments: { inApp: false } },
    });
    await schedule(seeded, 'Rent', addDaysToIsoDate(today, 3));
    await schedule(seeded, 'Salary', addDaysToIsoDate(today, 1), { type: 'income' });
    await schedule(seeded, 'Insurance', addDaysToIsoDate(today, -2));

    await drain(worker(seeded));
    expect(await reminders(seeded)).toEqual([
      'recurring_payment_upcoming | Salary expected in 1 day',
    ]);

    // A longer lead time is a new reminder identity: Rent now qualifies.
    await setPreferences(user, { paymentLeadDays: 7 });
    await queueReview(prisma, user, today, seeded.context.clock.now(), 'lead-7');
    await drain(worker(seeded));
    expect(await reminders(seeded)).toEqual([
      'recurring_payment_upcoming | Rent is due in 3 days',
      'recurring_payment_upcoming | Salary expected in 1 day',
    ]);
  });

  it('treats a postponed occurrence as a new due date and suppresses the out-of-date e-mail', async () => {
    const seeded = await seed();
    const { user, today, context } = seeded;
    await setPreferences(user, { channels: { overdue_payments: { email: true } } });
    const insurance = await schedule(seeded, 'Insurance', addDaysToIsoDate(today, -2));

    // The overdue reminder is created, but its e-mail cannot be sent yet.
    context.email.failWith = 'retryable';
    await drain(worker(seeded));
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { userId: user.session.user.id },
    });
    expect(delivery).toMatchObject({
      status: 'retry_scheduled',
      lastErrorCode: 'simulated_retryable',
    });

    // Postponed to tomorrow: the queued "overdue" e-mail is no longer true.
    await withCsrf(
      user.agent.post(occurrence(insurance, addDaysToIsoDate(today, -2), 'postpone')),
      user,
    )
      .send({ dueDate: addDaysToIsoDate(today, 1) })
      .expect(200);
    context.email.failWith = undefined;
    const later = new Date(context.clock.now().getTime() + 10 * 60_000);
    await queueReview(prisma, user, today, later, 'after-postpone');
    await drain(worker(seeded, () => later));

    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).toMatchObject({ status: 'suppressed', lastErrorCode: 'occurrence_rescheduled' });
    expect(await reminders(seeded)).toEqual([
      'recurring_payment_overdue | Insurance is overdue',
      'recurring_payment_upcoming | Insurance is due in 1 day',
    ]);
    // The in-app notification stays: suppression only stops the e-mail.
    expect(
      context.email.outbox.filter((message) => message.template.startsWith('notification:')),
    ).toEqual([]);
  });

  it('stops reminding about a schedule that is paused, ended, or resolved before delivery', async () => {
    const seeded = await seed();
    const { user, today, context } = seeded;
    await setPreferences(user, { channels: { upcoming_payments: { email: true } } });
    const rent = await schedule(seeded, 'Rent', addDaysToIsoDate(today, 2));
    context.email.failWith = 'retryable';
    await drain(worker(seeded));
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { userId: user.session.user.id },
    });

    // Recorded early (the existing, user-confirmed workflow): the reminder e-mail is dropped.
    await withCsrf(user.agent.post(occurrence(rent, addDaysToIsoDate(today, 2), 'record')), user)
      .send({})
      .expect(201);
    context.email.failWith = undefined;
    const later = new Date(context.clock.now().getTime() + 10 * 60_000);
    await drain(worker(seeded, () => later));
    expect(
      await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).toMatchObject({ status: 'suppressed', lastErrorCode: 'occurrence_resolved' });

    // A paused schedule gets nothing; resuming makes its next occurrence eligible again.
    const gym = await schedule(seeded, 'Gym', addDaysToIsoDate(today, 1), { frequency: 'weekly' });
    await withCsrf(user.agent.post(`${RECURRING}/${gym}/pause`), user).expect(200);
    await queueReview(prisma, user, today, later, 'paused');
    await drain(worker(seeded, () => later));
    expect((await reminders(seeded)).some((entry) => entry.includes('Gym'))).toBe(false);
    await withCsrf(user.agent.post(`${RECURRING}/${gym}/resume`), user).expect(200);
    await queueReview(prisma, user, today, later, 'resumed');
    await drain(worker(seeded, () => later));
    expect(await reminders(seeded)).toContain('recurring_payment_upcoming | Gym is due in 1 day');
  });

  it('expires a missed day instead of replaying it, and catches up on what is still relevant', async () => {
    const seeded = await seed();
    const { user, today, context } = seeded;
    await schedule(seeded, 'Rent', addDaysToIsoDate(today, 1));
    // Yesterday's review was never run: it expired at local midnight and is never executed.
    const yesterday = addDaysToIsoDate(today, -1);
    await prisma.automationJob.create({
      data: {
        kind: 'daily_review',
        userId: user.session.user.id,
        dedupeKey: `daily_review:${user.session.user.id}:${yesterday}`,
        payload: { v: 1, localDate: yesterday },
        runAt: new Date(context.clock.now().getTime() - 30 * 60 * 60 * 1000),
        expiresAt: new Date(context.clock.now().getTime() - 60_000),
      },
    });
    await drain(worker(seeded));
    expect(
      await prisma.automationJob.findFirstOrThrow({
        where: { dedupeKey: `daily_review:${user.session.user.id}:${yesterday}` },
      }),
    ).toMatchObject({ status: 'expired', attempts: 0 });
    // Today's review (from the scheduler) still reminds about what is upcoming now.
    expect(await reminders(seeded)).toEqual(['recurring_payment_upcoming | Rent is due in 1 day']);
  });
});
