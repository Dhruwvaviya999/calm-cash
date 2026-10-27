import {
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  dashboardCategoriesDtoSchema,
  dashboardOverviewDtoSchema,
  dashboardTrendsDtoSchema,
  transactionSummaryDtoSchema,
  type DashboardCategoriesDto,
  type DashboardOverviewDto,
  type DashboardTrendsDto,
  type TransactionListItemDto,
  type TrendBucketDto,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNTS,
  categoryId,
  createAccount,
  newUser,
  parseError,
  record,
  TRANSACTIONS,
} from '../../testing/finance-helpers';
import {
  AUTH,
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';

const DASHBOARD = `${API_V1_PREFIX}/dashboard`;
const MARCH = 'period=custom&from=2026-03-01&to=2026-03-31';

const { prisma, createContext } = useIntegrationDatabase();

async function overview(user: SignedIn, query: string): Promise<DashboardOverviewDto> {
  const response = await user.agent.get(`${DASHBOARD}/overview?${query}`).expect(200);
  return apiSuccessResponseSchema(dashboardOverviewDtoSchema).parse(response.body).data;
}

async function trends(user: SignedIn, query: string): Promise<DashboardTrendsDto> {
  const response = await user.agent.get(`${DASHBOARD}/trends?${query}`).expect(200);
  return apiSuccessResponseSchema(dashboardTrendsDtoSchema).parse(response.body).data;
}

async function categories(user: SignedIn, query: string): Promise<DashboardCategoriesDto> {
  const response = await user.agent.get(`${DASHBOARD}/categories?${query}`).expect(200);
  return apiSuccessResponseSchema(dashboardCategoriesDtoSchema).parse(response.body).data;
}

interface Ledger {
  context: TestContext;
  user: SignedIn;
  bank: string;
  cash: string;
  card: string;
  usd: string;
}

/**
 * A realistic ledger for an Asia/Kolkata user (UTC+05:30). Expected figures in the tests are
 * worked out by hand from the amounts below, not by calling the code under test.
 */
async function seed(): Promise<Ledger> {
  const context = createContext();
  const user = await newUser(context);
  const opened = { openingBalanceDate: '2026-01-01' };
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '5000000',
      ...opened,
    })
  ).account.id;
  const cash = (
    await createAccount(user, {
      name: 'Cash',
      type: 'cash',
      currency: 'INR',
      openingBalanceMinor: '200000',
      ...opened,
    })
  ).account.id;
  const card = (
    await createAccount(user, {
      name: 'Card',
      type: 'credit_card',
      currency: 'INR',
      openingBalanceMinor: '-1250000',
      creditLimitMinor: '10000000',
      ...opened,
    })
  ).account.id;
  const usd = (
    await createAccount(user, {
      name: 'US',
      type: 'bank',
      currency: 'USD',
      openingBalanceMinor: '100000',
      ...opened,
    })
  ).account.id;
  const old = (
    await createAccount(user, {
      name: 'Old savings',
      type: 'savings',
      currency: 'INR',
      openingBalanceMinor: '30000',
      ...opened,
    })
  ).account.id;
  await withCsrf(user.agent.post(`${ACCOUNTS}/${old}/archive`), user).expect(200);

  const salary = await categoryId(user, 'income', 'Salary');
  const groceries = await categoryId(user, 'expense', 'Groceries');
  const restaurants = await categoryId(user, 'expense', 'Restaurants');
  const food = await categoryId(user, 'expense', 'Food');
  const fuel = await categoryId(user, 'expense', 'Fuel');
  const spend = (
    accountId: string,
    amountMinor: string,
    occurredAt: string,
    category: string,
  ): Promise<TransactionListItemDto> =>
    record(user, {
      type: 'expense',
      accountId,
      amountMinor,
      occurredAt,
      description: 'Spend',
      categoryId: category,
    });

  // Previous period of the custom March range (29 Jan – 28 Feb): income 80,000, spending 1,000.
  await record(user, {
    type: 'income',
    accountId: bank,
    amountMinor: '8000000',
    occurredAt: '2026-02-15T06:00:00.000Z',
    description: 'Feb salary',
    categoryId: salary,
  });
  await spend(bank, '100000', '2026-02-16T06:00:00.000Z', groceries);

  // March (Asia/Kolkata): income 85,000.00 on 1 Mar 09:30 local.
  await record(user, {
    type: 'income',
    accountId: bank,
    amountMinor: '8500000',
    occurredAt: '2026-03-01T04:00:00.000Z',
    description: 'March salary',
    categoryId: salary,
  });
  await spend(bank, '245000', '2026-03-05T06:00:00.000Z', groceries);
  await spend(card, '80000', '2026-03-10T06:00:00.000Z', restaurants); // card spending is spending
  await spend(cash, '20000', '2026-03-12T06:00:00.000Z', food);
  // 31 Mar 23:59 local: still March.
  await spend(bank, '50000', '2026-03-31T18:29:00.000Z', fuel);
  // 1 Apr 00:00 local: April.
  await spend(bank, '70000', '2026-03-31T18:30:00.000Z', groceries);
  // A legacy expense without a category (written directly, as Phase 1–4 rows could be).
  await prisma.transaction.create({
    data: {
      userId: user.session.user.id,
      accountId: bank,
      type: 'expense',
      amountMinor: 33_300n,
      currency: 'INR',
      description: 'Old entry',
      occurredAt: new Date('2026-03-20T06:00:00.000Z'),
      createdAt: new Date('2026-03-20T06:00:00.000Z'),
    },
  });

  // Never income or spending: a transfer, an adjustment, a voided expense.
  await record(user, {
    type: 'transfer',
    accountId: bank,
    transferAccountId: card,
    amountMinor: '500000',
    occurredAt: '2026-03-15T06:00:00.000Z',
    description: 'Card bill',
  });
  await record(user, {
    type: 'balance_adjustment',
    accountId: bank,
    adjustmentDirection: 'decrease',
    amountMinor: '1000',
    occurredAt: '2026-03-16T06:00:00.000Z',
    description: 'Bank fee found on statement',
  });
  const voided = await spend(bank, '999900', '2026-03-17T06:00:00.000Z', groceries);
  await withCsrf(user.agent.post(`${TRANSACTIONS}/${voided.transaction.id}/void`), user).expect(
    200,
  );

  // Another currency.
  await record(user, {
    type: 'expense',
    accountId: usd,
    amountMinor: '5000',
    occurredAt: '2026-03-08T06:00:00.000Z',
    description: 'Book',
    categoryId: groceries,
  });

  return { context, user, bank, cash, card, usd };
}

describe('GET /dashboard/overview', () => {
  it('reports cash flow, savings rate, and comparison from persisted records', async () => {
    const { user } = await seed();

    const result = await overview(user, MARCH);

    expect(result.period).toEqual({
      period: 'custom',
      from: '2026-03-01',
      to: '2026-03-31',
      timeZone: 'Asia/Kolkata',
    });
    expect(result.currency).toBe('INR');
    // Income 85,000.00; spending 2,450 + 800 + 200 + 333 + 500 = 4,283.00.
    expect(result.cashFlow).toEqual({
      incomeMinor: '8500000',
      expenseMinor: '428300',
      netMinor: '8071700',
      incomeCount: 1,
      expenseCount: 5,
    });
    // 80,717 ÷ 85,000 = 94.9611…% → 9,496 basis points.
    expect(result.savingsRate).toEqual({ status: 'available', basisPoints: '9496' });
    // Against 29 Jan – 28 Feb (31 days before): income 80,000, spending 1,000.
    expect(result.comparison).toEqual({
      status: 'available',
      from: '2026-01-29',
      to: '2026-02-28',
      income: {
        previousMinor: '8000000',
        changeMinor: '500000',
        changePercent: { status: 'available', basisPoints: '625' },
      },
      expense: {
        previousMinor: '100000',
        changeMinor: '328300',
        changePercent: { status: 'available', basisPoints: '32830' },
      },
      net: { previousMinor: '7900000', changeMinor: '171700' },
    });
  });

  it('reports the current position per currency, separating money held from money owed', async () => {
    const { user } = await seed();

    const result = await overview(user, MARCH);

    expect(result.currencies).toEqual(['INR', 'USD']);
    expect(result.accounts).toEqual({ active: 4, archived: 1 });
    expect(result.hasTransactions).toBe(true);
    // HDFC: 50,000 + 80,000 + 85,000 − 1,000 − 2,450 − 333 − 500 − 700 − 5,000 (card bill) − 10
    // = 2,05,007.00; cash 2,000 − 200 = 1,800. The archived account is not part of the position.
    // Card: owes 12,500 + 800 − 5,000 = 8,300. USD: 1,000 − 50 = 950.
    expect(result.position).toEqual({
      currencies: [
        {
          currency: 'INR',
          assetsMinor: '20680700',
          liabilitiesMinor: '830000',
          assetAccounts: 2,
          liabilityAccounts: 1,
        },
        {
          currency: 'USD',
          assetsMinor: '95000',
          liabilitiesMinor: '0',
          assetAccounts: 1,
          liabilityAccounts: 0,
        },
      ],
    });
    // The position does not depend on the period.
    expect((await overview(user, 'period=custom&from=2026-01-01&to=2026-01-31')).position).toEqual(
      result.position,
    );
  });

  it('keeps every currency apart', async () => {
    const { user } = await seed();

    const result = await overview(user, `${MARCH}&currency=USD`);

    expect(result.currency).toBe('USD');
    expect(result.cashFlow).toEqual({
      incomeMinor: '0',
      expenseMinor: '5000',
      netMinor: '-5000',
      incomeCount: 0,
      expenseCount: 1,
    });
    expect(result.savingsRate).toEqual({ status: 'unavailable', reason: 'no_income' });
    expect(result.comparison).toMatchObject({
      status: 'unavailable',
      reason: 'no_previous_activity',
    });
  });

  it('agrees exactly with the transaction summary for the same period', async () => {
    const { user } = await seed();

    const dashboard = await overview(user, MARCH);
    const response = await user.agent
      .get(`${TRANSACTIONS}/summary?from=2026-03-01&to=2026-03-31`)
      .expect(200);
    const summary = apiSuccessResponseSchema(transactionSummaryDtoSchema).parse(response.body).data;
    const inr = summary.currencies.find((entry) => entry.currency === 'INR');

    expect(inr).toEqual({ currency: 'INR', ...dashboard.cashFlow });
  });

  it('reads calendar periods in the user’s time zone', async () => {
    const { user } = await seed();
    await withCsrf(user.agent.patch(`${AUTH}/profile`), user)
      .send({ timezone: 'America/New_York' })
      .expect(200);

    const result = await overview(user, MARCH);

    // In New York the salary (1 Mar 04:00 UTC) fell on 28 Feb, and both late-March expenses
    // (31 Mar 18:29 and 18:30 UTC) on 31 Mar: spending 4,283 + 700 = 4,983.00.
    expect(result.period.timeZone).toBe('America/New_York');
    expect(result.cashFlow).toMatchObject({
      incomeMinor: '0',
      expenseMinor: '498300',
      expenseCount: 6,
    });
  });

  it('gives a new user honest zeros and unavailable states, never sample figures', async () => {
    const context = createContext();
    const user = await newUser(context);

    const { comparison, ...result } = await overview(user, 'period=this-month');
    const today = calendarDateInTimeZone(context.clock.now(), 'Asia/Kolkata');

    expect(comparison).toMatchObject({ status: 'unavailable', reason: 'no_previous_activity' });
    expect(result).toEqual({
      period: {
        period: 'this-month',
        from: `${today.slice(0, 7)}-01`,
        to: today,
        timeZone: 'Asia/Kolkata',
      },
      currency: 'INR',
      currencies: [],
      position: { currencies: [] },
      accounts: { active: 0, archived: 0 },
      hasTransactions: false,
      cashFlow: {
        incomeMinor: '0',
        expenseMinor: '0',
        netMinor: '0',
        incomeCount: 0,
        expenseCount: 0,
      },
      savingsRate: { status: 'unavailable', reason: 'no_income' },
    });
  });

  it('keeps large amounts exact', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = (
      await createAccount(user, {
        name: 'Big',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '0',
        openingBalanceDate: '2026-01-01',
      })
    ).account.id;
    const salary = await categoryId(user, 'income', 'Salary');
    for (const day of ['02', '03']) {
      await record(user, {
        type: 'income',
        accountId: bank,
        amountMinor: '999999999999999',
        occurredAt: `2026-03-${day}T06:00:00.000Z`,
        description: 'Windfall',
        categoryId: salary,
      });
    }

    const result = await overview(user, MARCH);

    expect(result.cashFlow.incomeMinor).toBe('1999999999999998');
    expect(result.savingsRate).toEqual({ status: 'available', basisPoints: '10000' });
  });
});

describe('GET /dashboard/trends', () => {
  it('buckets income and spending by day in the user’s calendar, with real zeros', async () => {
    const { user } = await seed();

    const result = await trends(user, MARCH);

    expect(result.granularity).toBe('day');
    expect(result.buckets).toHaveLength(31);
    const day = (date: string): TrendBucketDto | undefined =>
      result.buckets.find((bucket) => bucket.start === date);
    expect(day('2026-03-01')).toMatchObject({ incomeMinor: '8500000', expenseMinor: '0' });
    expect(day('2026-03-02')).toMatchObject({ incomeMinor: '0', expenseMinor: '0', netMinor: '0' });
    expect(day('2026-03-15')).toMatchObject({ incomeMinor: '0', expenseMinor: '0' }); // transfer only
    expect(day('2026-03-17')).toMatchObject({ expenseMinor: '0' }); // voided only
    expect(day('2026-03-31')).toMatchObject({ expenseMinor: '50000' });
    // The buckets add up to the overview's totals.
    const sum = (field: 'incomeMinor' | 'expenseMinor'): bigint =>
      result.buckets.reduce((total, bucket) => total + BigInt(bucket[field]), 0n);
    expect(sum('incomeMinor')).toBe(8_500_000n);
    expect(sum('expenseMinor')).toBe(428_300n);
  });

  it('uses weeks and months for longer periods, marking partial buckets', async () => {
    const { user } = await seed();

    const monthly = await trends(user, 'period=custom&from=2026-02-10&to=2026-04-30');
    expect(monthly.granularity).toBe('week');

    const quarter = await trends(user, 'period=custom&from=2026-01-15&to=2026-06-30');
    expect(quarter.granularity).toBe('week');
    const year = await trends(user, 'period=custom&from=2025-12-15&to=2026-09-30');
    expect(year.granularity).toBe('month');
    expect(year.buckets[0]).toMatchObject({
      start: '2025-12-15',
      end: '2025-12-31',
      partial: true,
    });
    const march = year.buckets.find((bucket) => bucket.start === '2026-03-01');
    expect(march).toMatchObject({
      end: '2026-03-31',
      partial: false,
      incomeMinor: '8500000',
      expenseMinor: '428300',
    });
    const april = year.buckets.find((bucket) => bucket.start === '2026-04-01');
    expect(april).toMatchObject({ expenseMinor: '70000' });
  });
});

describe('GET /dashboard/categories', () => {
  it('ranks spending by top-level category, including real uncategorised spending', async () => {
    const { user } = await seed();

    const result = await categories(user, MARCH);

    expect(result.totalExpenseMinor).toBe('428300');
    expect(result.expenseCount).toBe(5);
    // Groceries 2,450; Food 1,000 (Restaurants 800 + Food 200); Transport 500 (Fuel); none 333.
    expect(
      result.entries.map((entry) => [
        entry.kind === 'category' ? entry.name : entry.kind,
        entry.amountMinor,
        entry.transactionCount,
        entry.shareBasisPoints,
      ]),
    ).toEqual([
      ['Groceries', '245000', 1, '5720'],
      ['Food', '100000', 2, '2335'],
      ['Transport', '50000', 1, '1167'],
      ['uncategorized', '33300', 1, '777'],
    ]);
  });

  it('only ever uses the caller’s own records', async () => {
    const { context, user } = await seed();
    const other = await newUser(context);
    const theirBank = (
      await createAccount(other, {
        name: 'Theirs',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '0',
        openingBalanceDate: '2026-01-01',
      })
    ).account.id;
    await record(other, {
      type: 'expense',
      accountId: theirBank,
      amountMinor: '777700',
      occurredAt: '2026-03-05T06:00:00.000Z',
      description: 'Theirs',
      categoryId: await categoryId(other, 'expense', 'Travel'),
    });

    expect((await categories(user, MARCH)).totalExpenseMinor).toBe('428300');
    expect((await overview(user, MARCH)).cashFlow.expenseMinor).toBe('428300');
    const theirs = await overview(other, MARCH);
    expect(theirs.cashFlow.expenseMinor).toBe('777700');
    expect(theirs.position.currencies).toHaveLength(1);
    const theirCategories = (await categories(other, MARCH)).entries;
    expect(theirCategories).toHaveLength(1);
    expect(theirCategories[0]).toMatchObject({
      kind: 'category',
      name: 'Travel',
      amountMinor: '777700',
    });
  });
});

describe('dashboard requests', () => {
  it('rejects invalid periods and currencies', async () => {
    const { user } = await seed();
    for (const query of [
      'period=forever',
      'currency=XYZ',
      'period=custom&from=2026-03-01',
      'period=custom&from=2026-03-31&to=2026-03-01',
      'period=custom&from=2026-03-01&to=2999-01-01',
      'period=this-month&from=2026-03-01',
      `userId=${user.session.user.id}`,
    ]) {
      const response = await user.agent.get(`${DASHBOARD}/overview?${query}`);
      expect(response.status, query).toBe(400);
      expect(parseError(response.body).code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a session and is never cached', async () => {
    const { context, user } = await seed();
    for (const path of ['overview', 'trends', 'categories']) {
      await request(context.app).get(`${DASHBOARD}/${path}`).expect(401);
      const response = await user.agent.get(`${DASHBOARD}/${path}`).expect(200);
      expect(response.get('Cache-Control')).toBe('no-store');
    }
  });
});
