import {
  addMonthsToIsoDate,
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  budgetWithProgressDtoSchema,
  calendarDateInTimeZone,
  firstOfMonth,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  createTestWorker,
  drain,
  notificationsOf,
  setPreferences,
} from '../testing/automation-helpers';
import {
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  postTransaction,
  record,
  TRANSACTIONS,
} from '../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../testing/integration-harness';

// Budget alerts end to end: spending recorded through the real API records a durable re-check in
// the same database transaction, and the worker turns it into alerts from the budget engine.

const BUDGETS = `${API_V1_PREFIX}/budgets`;
const TIME_ZONE = 'Asia/Kolkata';

const { prisma, createContext } = useIntegrationDatabase();

interface Seeded {
  context: TestContext;
  user: SignedIn;
  today: string;
  bank: string;
  cash: string;
  usd: string;
  groceries: string;
  food: string;
  salary: string;
  /** An instant just before the test clock's "now" (always in the current month). */
  at: string;
}

async function seed(): Promise<Seeded> {
  const context = createContext();
  const user = await newUser(context);
  const now = context.clock.now();
  const today = calendarDateInTimeZone(now, TIME_ZONE);
  const opened = { openingBalanceDate: addMonthsToIsoDate(today, -6) };
  const account = async (body: Record<string, unknown>): Promise<string> =>
    (await createAccount(user, { ...opened, ...body })).account.id;
  return {
    context,
    user,
    today,
    bank: await account({
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '10000000',
    }),
    cash: await account({
      name: 'Wallet',
      type: 'cash',
      currency: 'INR',
      openingBalanceMinor: '0',
    }),
    usd: await account({
      name: 'US',
      type: 'bank',
      currency: 'USD',
      openingBalanceMinor: '500000',
    }),
    groceries: await categoryId(user, 'expense', 'Groceries'),
    food: await categoryId(user, 'expense', 'Food'),
    salary: await categoryId(user, 'income', 'Salary'),
    at: new Date(now.getTime() - 1_000).toISOString(),
  };
}

async function spend(
  seeded: Seeded,
  amountMinor: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const item = await record(seeded.user, {
    type: 'expense',
    accountId: seeded.bank,
    amountMinor,
    occurredAt: seeded.at,
    description: 'Spend',
    categoryId: seeded.groceries,
    ...overrides,
  });
  return item.transaction.id;
}

async function createBudget(seeded: Seeded, body: Record<string, unknown>): Promise<string> {
  const response = await withCsrf(seeded.user.agent.post(BUDGETS), seeded.user).send({
    name: 'Groceries',
    categoryId: seeded.groceries,
    limitMinor: '10000',
    currency: 'INR',
    period: 'monthly',
    startDate: firstOfMonth(seeded.today),
    ...body,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return apiSuccessResponseSchema(budgetWithProgressDtoSchema).parse(response.body).data.budget.id;
}

function worker(seeded: Seeded): ReturnType<typeof createTestWorker> {
  return createTestWorker(prisma, { email: seeded.context.email, now: seeded.context.clock.now });
}

/** Budget alerts in level order (alerts created by one run share their creation instant). */
async function alerts(seeded: Seeded): Promise<{ type: string; key: string; title: string }[]> {
  const level = (key: string): number => Number(key.split(':').at(-1));
  return (await notificationsOf(prisma, seeded.user))
    .filter((row) => row.type.startsWith('budget_'))
    .map((row) => ({ type: row.type, key: row.dedupeKey, title: row.title }))
    .sort((a, b) => {
      const scope = (key: string): string => key.slice(0, key.lastIndexOf(':'));
      return scope(a.key).localeCompare(scope(b.key)) || level(a.key) - level(b.key);
    });
}

describe('budget alerts', () => {
  it('alerts once per threshold from ledger spending, through edits, voids, and restores', async () => {
    const seeded = await seed();
    const { user } = seeded;
    const budgetId = await createBudget(seeded, { alertThresholdsBp: [5000, 8000] });
    const from = firstOfMonth(seeded.today);
    const key = (level: number): string => `budget:${budgetId}:${from}:10000:${level.toString()}`;

    await spend(seeded, '4000'); // 40 %
    await drain(worker(seeded));
    expect(await alerts(seeded)).toEqual([]);

    await spend(seeded, '1500'); // 55 %
    await drain(worker(seeded));
    expect(await alerts(seeded)).toEqual([
      {
        type: 'budget_approaching_limit',
        key: key(5000),
        title: 'Groceries has used 55% of its budget',
      },
    ]);

    // Repeated evaluation never repeats an alert.
    await withCsrf(user.agent.patch(`${BUDGETS}/${budgetId}`), user).send({ name: 'Groceries' });
    await drain(worker(seeded));
    expect(await alerts(seeded)).toHaveLength(1);

    // Income, transfers, adjustments, another currency, and another category are not this spending.
    await record(user, {
      type: 'income',
      accountId: seeded.bank,
      amountMinor: '100000',
      occurredAt: seeded.at,
      description: 'Salary',
      categoryId: seeded.salary,
    });
    await record(user, {
      type: 'transfer',
      accountId: seeded.bank,
      transferAccountId: seeded.cash,
      amountMinor: '50000',
      occurredAt: seeded.at,
      description: 'To wallet',
    });
    await record(user, {
      type: 'balance_adjustment',
      accountId: seeded.bank,
      adjustmentDirection: 'decrease',
      amountMinor: '50000',
      occurredAt: seeded.at,
      description: 'Fee',
    });
    await spend(seeded, '50000', { accountId: seeded.usd });
    await spend(seeded, '50000', { categoryId: seeded.food });
    await drain(worker(seeded));
    expect(await alerts(seeded)).toHaveLength(1);

    // 85 %: the 80 % threshold.
    const big = await spend(seeded, '3000');
    await drain(worker(seeded));
    expect((await alerts(seeded)).map((alert) => alert.key)).toEqual([key(5000), key(8000)]);

    // Voiding drops spending below 80 %; restoring it does not alert a second time.
    await withCsrf(user.agent.post(`${TRANSACTIONS}/${big}/void`), user)
      .send({})
      .expect(200);
    await drain(worker(seeded));
    await withCsrf(user.agent.post(`${TRANSACTIONS}/${big}/restore`), user).expect(200);
    await drain(worker(seeded));
    expect(await alerts(seeded)).toHaveLength(2);

    // An edit that pushes spending past the limit: the limit alert, saying how far over.
    await withCsrf(user.agent.patch(`${TRANSACTIONS}/${big}`), user)
      .send({ amountMinor: '6000' })
      .expect(200);
    await drain(worker(seeded));
    const all = await alerts(seeded);
    expect(all.map((alert) => alert.key)).toEqual([key(5000), key(8000), key(10000)]);
    expect(all[2]).toMatchObject({
      type: 'budget_limit_reached',
      title: 'Groceries is over budget',
    });
    const limitAlert = (await notificationsOf(prisma, user)).find(
      (row) => row.dedupeKey === key(10000),
    );
    expect(limitAlert?.body).toContain('₹115.00 spent of ₹100.00');
    expect(limitAlert?.body).toContain('₹15.00 over the limit');
    expect(limitAlert?.target).toEqual({ kind: 'budget', budgetId, periodFrom: from });

    // Alerts are informational: the worker never touched the ledger.
    // Opening 100,000.00 − groceries 115.00 + salary 1,000.00 − transfer, fee, and food 500.00 each.
    expect(await balanceOf(user, seeded.bank)).toBe(9_938_500n);
  });

  it('creates one alert for the highest level when one expense jumps past several', async () => {
    const seeded = await seed();
    const budgetId = await createBudget(seeded, { alertThresholdsBp: [5000, 8000] });
    await spend(seeded, '11000');
    await drain(worker(seeded));
    const rows = await alerts(seeded);
    expect(rows).toEqual([
      {
        type: 'budget_limit_reached',
        key: `budget:${budgetId}:${firstOfMonth(seeded.today)}:10000:10000`,
        title: 'Groceries is over budget',
      },
    ]);
    // Lower levels are covered by the higher one, even after spending falls and rises again.
    await spend(seeded, '1');
    await drain(worker(seeded));
    expect(await alerts(seeded)).toHaveLength(1);
  });

  it('follows threshold and limit changes, and stays quiet for archived budgets', async () => {
    const seeded = await seed();
    const { user } = seeded;
    const budgetId = await createBudget(seeded, { alertThresholdsBp: [8000] });
    await spend(seeded, '6000'); // 60 %
    await drain(worker(seeded));
    expect(await alerts(seeded)).toEqual([]);

    // A new threshold is a new identity; the budget write itself queues the re-check.
    await withCsrf(user.agent.patch(`${BUDGETS}/${budgetId}`), user)
      .send({ alertThresholdsBp: [5000, 8000] })
      .expect(200);
    await drain(worker(seeded));
    expect((await alerts(seeded)).map((alert) => alert.key)).toEqual([
      `budget:${budgetId}:${firstOfMonth(seeded.today)}:10000:5000`,
    ]);

    // A higher limit: 6,000 of 20,000 is 30 %, and reaching 50 % of it is a new alert.
    await withCsrf(user.agent.patch(`${BUDGETS}/${budgetId}`), user)
      .send({ limitMinor: '20000' })
      .expect(200);
    await spend(seeded, '4500'); // 10,500 of 20,000 = 52.5 %
    await drain(worker(seeded));
    expect((await alerts(seeded)).at(-1)?.key).toBe(
      `budget:${budgetId}:${firstOfMonth(seeded.today)}:20000:5000`,
    );

    // Archived budgets never alert.
    await withCsrf(user.agent.post(`${BUDGETS}/${budgetId}/archive`), user).expect(200);
    await spend(seeded, '20000');
    await drain(worker(seeded));
    expect(await alerts(seeded)).toHaveLength(2);
  });

  it('records the re-check in the same transaction as the spending, and only when it commits', async () => {
    const seeded = await seed();
    const { user } = seeded;
    await createBudget(seeded, {});
    await prisma.automationJob.deleteMany({});
    const pending = (): Promise<number> =>
      prisma.automationJob.count({
        where: { kind: 'budget_evaluation', userId: user.session.user.id, status: 'pending' },
      });

    // Refused (a cash account cannot go below zero): nothing committed, so no event either.
    const refused = await postTransaction(user, {
      type: 'expense',
      accountId: seeded.cash,
      amountMinor: '100',
      occurredAt: seeded.at,
      description: 'Too much',
      categoryId: seeded.groceries,
    });
    expect(refused.status).toBe(409);
    expect(await pending()).toBe(0);

    // Several committed changes while no worker runs coalesce into one waiting re-check.
    await spend(seeded, '100');
    await spend(seeded, '100');
    await spend(seeded, '100');
    expect(await pending()).toBe(1);
  });

  it('respects the person’s channels: nothing when both are off, e-mail only when chosen', async () => {
    const seeded = await seed();
    await createBudget(seeded, {});
    await setPreferences(seeded.user, {
      channels: { budget_alerts: { inApp: false, email: false } },
    });
    await spend(seeded, '9000');
    await drain(worker(seeded));
    expect(await alerts(seeded)).toEqual([]);

    await setPreferences(seeded.user, { channels: { budget_alerts: { email: true } } });
    await spend(seeded, '1');
    await drain(worker(seeded));
    const [alert] = await notificationsOf(prisma, seeded.user);
    // E-mail only: kept out of the notification center, delivered by e-mail.
    expect(alert).toMatchObject({ type: 'budget_approaching_limit', inApp: false });
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { userId: seeded.user.session.user.id },
    });
    expect(deliveries).toMatchObject([{ status: 'sent', attempts: 1 }]);
    const sent = seeded.context.email.outbox.filter((message) =>
      message.template.startsWith('notification:'),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: seeded.user.session.user.email,
      subject: 'Budget alert from CalmCash',
    });
    // Subjects never carry names or amounts.
    expect(sent[0]?.subject).not.toContain('Groceries');
    expect(sent[0]?.subject).not.toContain('₹');
  });
});
