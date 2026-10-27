import {
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  budgetListDtoSchema,
  budgetSummaryDtoSchema,
  budgetWithProgressDtoSchema,
  type BudgetListDto,
  type BudgetSummaryDto,
  type BudgetWithProgressDto,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
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
} from '../../testing/integration-harness';

const BUDGETS = `${API_V1_PREFIX}/budgets`;
const MARCH = '2026-03-15';

const { prisma, createContext } = useIntegrationDatabase();
const itemEnvelope = apiSuccessResponseSchema(budgetWithProgressDtoSchema);

async function createBudget(
  user: SignedIn,
  body: Record<string, unknown>,
): Promise<BudgetWithProgressDto> {
  const response = await withCsrf(user.agent.post(BUDGETS), user).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return itemEnvelope.parse(response.body).data;
}

async function listBudgets(user: SignedIn, query = `date=${MARCH}`): Promise<BudgetListDto> {
  const response = await user.agent.get(`${BUDGETS}?${query}`).expect(200);
  return apiSuccessResponseSchema(budgetListDtoSchema).parse(response.body).data;
}

async function spentOf(user: SignedIn, budgetId: string, date = MARCH): Promise<string> {
  const response = await user.agent.get(`${BUDGETS}/${budgetId}?date=${date}`).expect(200);
  return itemEnvelope.parse(response.body).data.progress.spentMinor;
}

async function summary(user: SignedIn, query = `date=${MARCH}`): Promise<BudgetSummaryDto> {
  const response = await user.agent.get(`${BUDGETS}/summary?${query}`).expect(200);
  return apiSuccessResponseSchema(budgetSummaryDtoSchema).parse(response.body).data;
}

interface Seeded {
  user: SignedIn;
  bank: string;
  card: string;
  usd: string;
  food: string;
  delivery: string;
  restaurants: string;
  groceries: string;
  salary: string;
}

/** An Asia/Kolkata user (UTC+05:30) with accounts opened on 1 January 2026. */
async function seed(): Promise<Seeded> {
  const user = await newUser(createContext());
  const opened = { openingBalanceDate: '2026-01-01' };
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '10000000',
      ...opened,
    })
  ).account.id;
  const card = (
    await createAccount(user, {
      name: 'Card',
      type: 'credit_card',
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
  return {
    user,
    bank,
    card,
    usd,
    food: await categoryId(user, 'expense', 'Food'),
    delivery: await categoryId(user, 'expense', 'Food delivery'),
    restaurants: await categoryId(user, 'expense', 'Restaurants'),
    groceries: await categoryId(user, 'expense', 'Groceries'),
    salary: await categoryId(user, 'income', 'Salary'),
  };
}

function spend(
  seeded: Seeded,
  accountId: string,
  amountMinor: string,
  occurredAt: string,
  category: string,
): ReturnType<typeof record> {
  return record(seeded.user, {
    type: 'expense',
    accountId,
    amountMinor,
    occurredAt,
    description: 'Spend',
    categoryId: category,
  });
}

const monthly = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  name: 'Budget',
  limitMinor: '1000000',
  currency: 'INR',
  period: 'monthly',
  startDate: '2026-01-01',
  ...overrides,
});

describe('budgets', () => {
  it('counts only active INR expenses in the period, with category roll-up and card spending', async () => {
    const seeded = await seed();
    const { user, bank, card, usd } = seeded;
    const overall = await createBudget(user, monthly({ name: 'Everything', limitMinor: '500000' }));
    const food = await createBudget(user, monthly({ name: 'Food', categoryId: seeded.food }));
    const delivery = await createBudget(
      user,
      monthly({ name: 'Delivery', categoryId: seeded.delivery, limitMinor: '100000' }),
    );

    // March in Asia/Kolkata. Expected by hand: food = 1,200 + 800 + 300 = 2,300.00;
    // delivery = 800.00; everything = food + groceries 2,500 = 4,800.00.
    await spend(seeded, bank, '120000', '2026-03-05T06:00:00.000Z', seeded.food);
    await spend(seeded, card, '80000', '2026-03-06T06:00:00.000Z', seeded.delivery); // card spend
    await spend(seeded, bank, '30000', '2026-03-07T06:00:00.000Z', seeded.restaurants);
    await spend(seeded, bank, '250000', '2026-03-31T18:29:00.000Z', seeded.groceries); // 23:59 local
    // Not March: 1 April 00:00 local, and 28 Feb 23:59 local.
    await spend(seeded, bank, '700000', '2026-03-31T18:30:00.000Z', seeded.groceries);
    await spend(seeded, bank, '700000', '2026-02-28T18:29:00.000Z', seeded.food);
    // Never spending: income, a transfer, an adjustment, a voided expense, another currency.
    await record(user, {
      type: 'income',
      accountId: bank,
      amountMinor: '900000',
      occurredAt: '2026-03-08T06:00:00.000Z',
      description: 'Salary',
      categoryId: seeded.salary,
    });
    await record(user, {
      type: 'transfer',
      accountId: bank,
      transferAccountId: card,
      amountMinor: '400000',
      occurredAt: '2026-03-09T06:00:00.000Z',
      description: 'Card bill',
    });
    await record(user, {
      type: 'balance_adjustment',
      accountId: bank,
      adjustmentDirection: 'decrease',
      amountMinor: '5000',
      occurredAt: '2026-03-10T06:00:00.000Z',
      description: 'Fee',
    });
    const voided = await spend(seeded, bank, '999900', '2026-03-11T06:00:00.000Z', seeded.food);
    await withCsrf(user.agent.post(`${TRANSACTIONS}/${voided.transaction.id}/void`), user).expect(
      200,
    );
    await spend(seeded, usd, '99900', '2026-03-12T06:00:00.000Z', seeded.food);

    const list = await listBudgets(user);
    const byId = new Map(list.budgets.map((item) => [item.budget.id, item]));
    const overallProgress = byId.get(overall.budget.id)?.progress;
    expect(overallProgress).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-31',
      partial: false,
      timing: 'current',
      spentMinor: '480000',
      remainingMinor: '20000',
      used: { status: 'available', basisPoints: '9600' },
      status: 'approaching_limit',
      reachedThresholdBp: 8000,
      transactionCount: 4,
    });
    expect(byId.get(food.budget.id)?.progress).toMatchObject({
      spentMinor: '230000',
      status: 'on_track',
    });
    // Overspent: the remaining amount goes negative and the percentage is not capped.
    expect(byId.get(delivery.budget.id)?.progress).toMatchObject({
      spentMinor: '80000',
      remainingMinor: '20000',
    });
    expect(byId.get(delivery.budget.id)?.category).toMatchObject({ parentName: 'Food' });

    // The summary never adds nested scopes: the overall budget alone gives the monthly totals.
    const totals = await summary(user);
    expect(totals.currency).toBe('INR');
    expect(totals.totals).toEqual([
      expect.objectContaining({
        period: 'monthly',
        scope: 'overall',
        budgetCount: 3,
        limitMinor: '500000',
        spentMinor: '480000',
      }),
    ]);

    // Without the overall budget, the subcategory budget sits inside Food and is not added again.
    await withCsrf(user.agent.post(`${BUDGETS}/${overall.budget.id}/archive`), user).expect(200);
    const categoriesOnly = await summary(user);
    expect(categoriesOnly.totals[0]).toMatchObject({
      scope: 'categories',
      budgetCount: 2,
      limitMinor: '1000000',
      spentMinor: '230000',
    });
  });

  it('follows transaction edits, voids, restores, and category changes', async () => {
    const seeded = await seed();
    const { user, bank } = seeded;
    const food = await createBudget(user, monthly({ name: 'Food', categoryId: seeded.food }));
    const expense = await spend(seeded, bank, '100000', '2026-03-05T06:00:00.000Z', seeded.food);
    expect(await spentOf(user, food.budget.id)).toBe('100000');

    await withCsrf(user.agent.patch(`${TRANSACTIONS}/${expense.transaction.id}`), user)
      .send({ amountMinor: '150000' })
      .expect(200);
    expect(await spentOf(user, food.budget.id)).toBe('150000');

    await withCsrf(user.agent.patch(`${TRANSACTIONS}/${expense.transaction.id}`), user)
      .send({ categoryId: seeded.groceries })
      .expect(200);
    expect(await spentOf(user, food.budget.id)).toBe('0');

    await withCsrf(user.agent.patch(`${TRANSACTIONS}/${expense.transaction.id}`), user)
      .send({ categoryId: seeded.delivery })
      .expect(200);
    expect(await spentOf(user, food.budget.id)).toBe('150000'); // subcategory rolls up

    await withCsrf(user.agent.post(`${TRANSACTIONS}/${expense.transaction.id}/void`), user).expect(
      200,
    );
    expect(await spentOf(user, food.budget.id)).toBe('0');
    await withCsrf(
      user.agent.post(`${TRANSACTIONS}/${expense.transaction.id}/restore`),
      user,
    ).expect(200);
    expect(await spentOf(user, food.budget.id)).toBe('150000');

    // A changed limit recalculates against the same spending.
    await withCsrf(user.agent.patch(`${BUDGETS}/${food.budget.id}`), user)
      .send({ limitMinor: '150000' })
      .expect(200);
    const march = await user.agent.get(`${BUDGETS}/${food.budget.id}?date=${MARCH}`).expect(200);
    expect(itemEnvelope.parse(march.body).data.progress).toMatchObject({
      status: 'limit_reached',
      remainingMinor: '0',
      used: { status: 'available', basisPoints: '10000' },
    });
    await withCsrf(user.agent.patch(`${BUDGETS}/${food.budget.id}`), user)
      .send({ limitMinor: '100000' })
      .expect(200);
    const over = await user.agent.get(`${BUDGETS}/${food.budget.id}?date=${MARCH}`).expect(200);
    expect(itemEnvelope.parse(over.body).data.progress).toMatchObject({
      status: 'over_budget',
      remainingMinor: '-50000',
      used: { status: 'available', basisPoints: '15000' },
    });
  });

  it('uses calendar periods in the user time zone, clipped to the start date', async () => {
    const seeded = await seed();
    const { user, bank } = seeded;
    await withCsrf(user.agent.patch(`${AUTH}/profile`), user)
      .send({ timezone: 'America/New_York' })
      .expect(200);
    const weekly = await createBudget(
      user,
      monthly({ period: 'weekly', startDate: '2026-03-04', limitMinor: '100000' }),
    );
    // Wednesday 4 March to Sunday 8 March (ISO week from Monday 2 March, clipped to the start).
    await spend(seeded, bank, '10000', '2026-03-04T05:00:00.000Z', seeded.food); // 00:00 EST
    // Clocks go forward on Sunday 8 March: 23:59 that night is EDT (UTC−4), not EST.
    await spend(seeded, bank, '20000', '2026-03-09T03:59:00.000Z', seeded.food); // Sun 23:59 EDT
    await spend(seeded, bank, '80000', '2026-03-09T04:00:00.000Z', seeded.food); // Mon 00:00 EDT
    await spend(seeded, bank, '40000', '2026-03-04T04:59:00.000Z', seeded.food); // Tue 23:59 EST
    const response = await user.agent
      .get(`${BUDGETS}/${weekly.budget.id}?date=2026-03-06`)
      .expect(200);
    expect(itemEnvelope.parse(response.body).data.progress).toMatchObject({
      from: '2026-03-04',
      to: '2026-03-08',
      partial: true,
      spentMinor: '30000',
    });
    // Before it starts, the first period is shown and nothing applies yet.
    const early = await user.agent
      .get(`${BUDGETS}/${weekly.budget.id}?date=2026-03-01`)
      .expect(200);
    expect(itemEnvelope.parse(early.body).data.progress).toMatchObject({
      timing: 'upcoming',
      status: 'not_applicable',
    });
  });

  it('validates categories, dates, thresholds, and overlapping budgets', async () => {
    const seeded = await seed();
    const { user } = seeded;
    const income = await withCsrf(user.agent.post(BUDGETS), user)
      .send(monthly({ categoryId: seeded.salary }))
      .expect(400);
    expect(parseError(income.body).details?.[0]?.path).toBe('body.categoryId');

    await withCsrf(user.agent.post(BUDGETS), user)
      .send(monthly({ period: 'custom' }))
      .expect(400);
    await withCsrf(user.agent.post(BUDGETS), user)
      .send(monthly({ alertThresholdsBp: [9000, 8000] }))
      .expect(400);
    await withCsrf(user.agent.post(BUDGETS), user)
      .send(monthly({ userId: user.session.user.id }))
      .expect(400);

    await createBudget(user, monthly({ name: 'Food', categoryId: seeded.food }));
    const clash = await withCsrf(user.agent.post(BUDGETS), user)
      .send(monthly({ name: 'Food again', categoryId: seeded.food, startDate: '2026-06-01' }))
      .expect(409);
    expect(parseError(clash.body).code).toBe('CONFLICT');
    // A different cadence or currency is a different budget.
    await createBudget(user, monthly({ categoryId: seeded.food, period: 'weekly' }));
    await createBudget(user, monthly({ categoryId: seeded.food, currency: 'USD' }));
    // A custom range is a one-off budget.
    const trip = await createBudget(
      user,
      monthly({
        name: 'Trip',
        period: 'custom',
        startDate: '2026-03-10',
        endDate: '2026-03-20',
        alertThresholdsBp: [],
      }),
    );
    expect(trip.budget.alertThresholdsBp).toEqual([]);
  });

  it('archives and restores, and never shows another user anything', async () => {
    const seeded = await seed();
    const { user } = seeded;
    const budget = await createBudget(user, monthly({ name: 'Mine' }));
    await withCsrf(user.agent.post(`${BUDGETS}/${budget.budget.id}/archive`), user).expect(200);
    await withCsrf(user.agent.post(`${BUDGETS}/${budget.budget.id}/archive`), user).expect(200);
    expect((await listBudgets(user)).budgets).toHaveLength(0);
    expect((await listBudgets(user, 'status=archived')).budgets).toHaveLength(1);
    await withCsrf(user.agent.patch(`${BUDGETS}/${budget.budget.id}`), user)
      .send({ name: 'Edited' })
      .expect(409);
    await withCsrf(user.agent.post(`${BUDGETS}/${budget.budget.id}/restore`), user).expect(200);
    expect((await listBudgets(user)).budgets).toHaveLength(1);

    const other = await newUser(createContext());
    await other.agent.get(`${BUDGETS}/${budget.budget.id}`).expect(404);
    await withCsrf(other.agent.patch(`${BUDGETS}/${budget.budget.id}`), other)
      .send({ name: 'Mine now' })
      .expect(404);
    await withCsrf(other.agent.post(`${BUDGETS}/${budget.budget.id}/archive`), other).expect(404);
    expect((await listBudgets(other)).budgets).toHaveLength(0);
    // Another user's category cannot scope my budget.
    const theirs = await categoryId(other, 'expense', 'Food');
    await withCsrf(user.agent.post(BUDGETS), user)
      .send(monthly({ categoryId: theirs }))
      .expect(400);
    expect(await prisma.budget.count()).toBe(1);
  });
});
