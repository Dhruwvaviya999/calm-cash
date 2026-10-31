import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  dashboardOverviewDtoSchema,
  firstOfMonth,
  zonedDateTimeToInstant,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  createTestWorker,
  drain,
  notificationsOf,
  queueReview,
  setPreferences,
} from '../testing/automation-helpers';
import {
  categoryId,
  createAccount,
  newUser,
  record,
  TRANSACTIONS,
} from '../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../testing/integration-harness';

// Monthly summaries end to end. The worker's clock is set to the 3rd of the current month (in the
// user's time zone), so "last month" is the previous calendar month whatever day the suite runs.

const TIME_ZONE = 'Asia/Kolkata';

const { prisma, createContext } = useIntegrationDatabase();

interface Seeded {
  context: TestContext;
  user: SignedIn;
  /** First and last day of the month being summarised. */
  from: string;
  to: string;
  /** The worker's "now": 09:00 local on the 3rd of the following month. */
  reviewAt: Date;
}

/** `occurredAt` at 10:00 local on day `day` of the summarised month. */
function inMonth(from: string, day: number): string {
  return zonedDateTimeToInstant(addDaysToIsoDate(from, day - 1), '10:00', TIME_ZONE).toISOString();
}

async function seed(): Promise<Seeded> {
  const context = createContext();
  const user = await newUser(context);
  const today = calendarDateInTimeZone(context.clock.now(), TIME_ZONE);
  const thisMonth = firstOfMonth(today);
  const from = addMonthsToIsoDate(thisMonth, -1);
  const opened = { openingBalanceDate: addMonthsToIsoDate(today, -6) };
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '10000000',
      ...opened,
    })
  ).account.id;
  const wallet = (
    await createAccount(user, {
      name: 'Wallet',
      type: 'cash',
      currency: 'INR',
      openingBalanceMinor: '0',
      ...opened,
    })
  ).account.id;
  const usd = (
    await createAccount(user, {
      name: 'US',
      type: 'bank',
      currency: 'USD',
      openingBalanceMinor: '500000',
      ...opened,
    })
  ).account.id;
  const groceries = await categoryId(user, 'expense', 'Groceries');
  const food = await categoryId(user, 'expense', 'Food');
  const salary = await categoryId(user, 'income', 'Salary');
  const base = { accountId: bank, description: 'Entry' };

  // Last month in INR, by hand: income 1,000.00; spending 300.00 + 100.00 = 400.00; net 600.00;
  // savings rate 60 %. Never cash flow: the transfer, the adjustment, the voided expense.
  await record(user, {
    ...base,
    type: 'income',
    amountMinor: '100000',
    categoryId: salary,
    occurredAt: inMonth(from, 1),
  });
  await record(user, {
    ...base,
    type: 'expense',
    amountMinor: '30000',
    categoryId: groceries,
    occurredAt: inMonth(from, 2),
  });
  await record(user, {
    ...base,
    type: 'expense',
    amountMinor: '10000',
    categoryId: food,
    occurredAt: inMonth(from, 3),
  });
  await record(user, {
    ...base,
    type: 'transfer',
    transferAccountId: wallet,
    amountMinor: '5000',
    occurredAt: inMonth(from, 4),
  });
  await record(user, {
    ...base,
    type: 'balance_adjustment',
    adjustmentDirection: 'decrease',
    amountMinor: '7000',
    occurredAt: inMonth(from, 5),
  });
  const voided = await record(user, {
    ...base,
    type: 'expense',
    amountMinor: '999900',
    categoryId: food,
    occurredAt: inMonth(from, 6),
  });
  await withCsrf(user.agent.post(`${TRANSACTIONS}/${voided.transaction.id}/void`), user)
    .send({})
    .expect(200);
  // USD spending without USD income: its savings rate is unavailable, never 0 % or −∞.
  await record(user, {
    type: 'expense',
    accountId: usd,
    amountMinor: '2000',
    categoryId: food,
    description: 'Entry',
    occurredAt: inMonth(from, 7),
  });

  return {
    context,
    user,
    from,
    to: addDaysToIsoDate(thisMonth, -1),
    reviewAt: zonedDateTimeToInstant(addDaysToIsoDate(thisMonth, 2), '09:00', TIME_ZONE),
  };
}

async function summaries(seeded: Seeded): Promise<{ key: string; title: string; body: string }[]> {
  return (await notificationsOf(prisma, seeded.user))
    .filter((row) => row.type === 'monthly_summary_ready')
    .map((row) => ({ key: row.dedupeKey, title: row.title, body: row.body }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

describe('monthly summaries', () => {
  it('summarises the completed month per currency, exactly as the dashboard does', async () => {
    const seeded = await seed();
    const { user, from, to, reviewAt } = seeded;
    const month = from.slice(0, 7);
    await drain(createTestWorker(prisma, { email: seeded.context.email, now: () => reviewAt }));

    const rows = await summaries(seeded);
    expect(rows.map((row) => row.key)).toEqual([`summary:${month}:INR`, `summary:${month}:USD`]);
    const [inr, usd] = rows;
    expect(inr?.body).toBe('Income ₹1,000.00 · spending ₹400.00 · net ₹600.00 · savings rate 60%.');
    expect(usd?.body).toContain('spending $20.00');
    expect(usd?.body).toContain('savings rate not available (no income recorded)');
    // Separate summaries: no amount ever adds rupees and dollars.
    expect(inr?.body).not.toContain('$');
    expect(usd?.body).not.toContain('₹');

    // The figures are the dashboard's own for that period and currency.
    const overview = apiSuccessResponseSchema(dashboardOverviewDtoSchema).parse(
      (
        await user.agent
          .get(
            `${API_V1_PREFIX}/dashboard/overview?period=custom&from=${from}&to=${to}&currency=INR`,
          )
          .expect(200)
      ).body,
    ).data;
    expect(overview.cashFlow).toMatchObject({
      incomeMinor: '100000',
      expenseMinor: '40000',
      netMinor: '60000',
    });
    const [notification] = (await notificationsOf(prisma, user)).filter(
      (row) => row.dedupeKey === `summary:${month}:INR`,
    );
    expect(notification?.target).toEqual({ kind: 'dashboard', from, to, currency: 'INR' });

    // Generated once per user, month, and currency, however often reviews run.
    await queueReview(prisma, user, to, reviewAt, 'again');
    await drain(createTestWorker(prisma, { email: seeded.context.email, now: () => reviewAt }));
    expect(await summaries(seeded)).toHaveLength(2);
  });

  it('never summarises a month that has not finished, and leaves old months alone', async () => {
    const seeded = await seed();
    const { reviewAt } = seeded;
    // On the 3rd, only last month qualifies: nothing about the current month exists yet.
    await drain(createTestWorker(prisma, { email: seeded.context.email, now: () => reviewAt }));
    const thisMonth = addDaysToIsoDate(seeded.to, 1).slice(0, 7);
    expect((await summaries(seeded)).some((row) => row.key.includes(thisMonth))).toBe(false);

    // Mid-month, outside the catch-up week: no summary at all (the month is left alone).
    const other = await seed();
    const midMonth = new Date(other.reviewAt.getTime() + 12 * 24 * 60 * 60 * 1000);
    await drain(createTestWorker(prisma, { email: other.context.email, now: () => midMonth }));
    expect(await summaries(other)).toEqual([]);
  });

  it('e-mails an accessible overview when chosen, with the figures and plans kept apart', async () => {
    const seeded = await seed();
    await setPreferences(seeded.user, { channels: { monthly_summary: { email: true } } });
    await drain(
      createTestWorker(prisma, { email: seeded.context.email, now: () => seeded.reviewAt }),
    );
    const emails = seeded.context.email.outbox.filter(
      (message) => message.template === 'notification:monthly_summary_ready',
    );
    expect(emails).toHaveLength(2);
    const inr = emails.find((message) => message.text.includes('₹'));
    expect(inr?.subject).toBe('Your monthly summary from CalmCash');
    expect(inr?.text).toContain('Income: ₹1,000.00 (1 transaction)');
    expect(inr?.text).toContain('Spending: ₹400.00 (2 transactions)');
    expect(inr?.text).toContain('Groceries: ₹300.00 (75% of spending)');
    // Plans stay apart from what happened (none are scheduled here, and it says so).
    expect(inr?.text).toContain('Still expected');
    expect(inr?.text).toContain('No scheduled payments are expected.');
    expect(inr?.text).not.toContain('$');
    expect(inr?.html).toContain('<html lang="en">');
    expect(inr?.html).toContain('/settings#notifications');
    expect(inr?.messageId).toMatch(/\.notification@localhost$/);
  });
});
