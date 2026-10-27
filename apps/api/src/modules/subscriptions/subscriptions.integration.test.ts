import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  recordedOccurrenceDtoSchema,
  savingsGoalDetailDtoSchema,
  savingsGoalListDtoSchema,
  subscriptionDtoSchema,
  subscriptionListDtoSchema,
  subscriptionSummaryDtoSchema,
  type SavingsGoalDetailDto,
  type SubscriptionDto,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  parseError,
} from '../../testing/finance-helpers';
import { useIntegrationDatabase, withCsrf, type SignedIn } from '../../testing/integration-harness';

const SUBSCRIPTIONS = `${API_V1_PREFIX}/subscriptions`;
const RECURRING = `${API_V1_PREFIX}/recurring`;
const GOALS = `${API_V1_PREFIX}/goals`;

const { prisma, createContext } = useIntegrationDatabase();
const subscriptionEnvelope = apiSuccessResponseSchema(subscriptionDtoSchema);
const goalEnvelope = apiSuccessResponseSchema(savingsGoalDetailDtoSchema);

async function subscribe(user: SignedIn, body: Record<string, unknown>): Promise<SubscriptionDto> {
  const response = await withCsrf(user.agent.post(SUBSCRIPTIONS), user).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return subscriptionEnvelope.parse(response.body).data;
}

describe('subscriptions', () => {
  it('estimates upcoming costs per currency and stops expecting charges once cancelled', async () => {
    const context = createContext();
    const user = await newUser(context);
    const today = calendarDateInTimeZone(context.clock.now(), 'Asia/Kolkata');
    const bank = (
      await createAccount(user, {
        name: 'HDFC',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '1000000',
      })
    ).account.id;
    const streaming = await categoryId(user, 'expense', 'Streaming');
    const start = addDaysToIsoDate(today, 3);
    const netflix = await subscribe(user, {
      name: 'Netflix',
      merchant: 'Netflix',
      amountMinor: '49900',
      accountId: bank,
      categoryId: streaming,
      frequency: 'monthly',
      startDate: start,
    });
    expect(netflix.status).toBe('active');
    expect(netflix.schedule).toMatchObject({ type: 'expense', isSubscription: true });
    // Twelve monthly charges from today: an estimate, not money spent.
    expect(netflix.nextTwelveMonths).toMatchObject({ occurrences: 12, amountMinor: '598800' });
    await subscribe(user, {
      name: 'Cloud',
      amountMinor: '299',
      currency: 'USD',
      frequency: 'yearly',
      startDate: addDaysToIsoDate(today, 10),
    });

    const summary = apiSuccessResponseSchema(subscriptionSummaryDtoSchema).parse(
      (await user.agent.get(`${SUBSCRIPTIONS}/summary`).expect(200)).body,
    ).data;
    expect(summary.currencies).toMatchObject([
      {
        currency: 'INR',
        activeCount: 1,
        next30Days: { occurrences: 1, amountMinor: '49900' },
        next12Months: { occurrences: 12, amountMinor: '598800' },
      },
      { currency: 'USD', next12Months: { occurrences: 1, amountMinor: '299' } },
    ]);

    // A charge is recorded through the recurring route, like any schedule.
    const charged = await withCsrf(
      user.agent.post(`${RECURRING}/${netflix.schedule.id}/occurrences/${start}/record`),
      user,
    )
      .send({})
      .expect(201);
    const recorded = apiSuccessResponseSchema(recordedOccurrenceDtoSchema).parse(charged.body).data;
    expect(await balanceOf(user, bank)).toBe(950_100n);

    // Cancel from the next billing date: that charge is still expected, later ones are not.
    const paused = subscriptionEnvelope.parse(
      (
        await withCsrf(
          user.agent.post(`${SUBSCRIPTIONS}/${netflix.schedule.id}/pause`),
          user,
        ).expect(200)
      ).body,
    ).data;
    expect(paused).toMatchObject({ status: 'paused', nextTwelveMonths: { occurrences: 0 } });
    await withCsrf(user.agent.post(`${SUBSCRIPTIONS}/${netflix.schedule.id}/resume`), user).expect(
      200,
    );
    const cancelled = subscriptionEnvelope.parse(
      (
        await withCsrf(user.agent.post(`${SUBSCRIPTIONS}/${netflix.schedule.id}/cancel`), user)
          .send({ effectiveDate: addMonthsToIsoDate(start, 1) })
          .expect(200)
      ).body,
    ).data;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.nextTwelveMonths.occurrences).toBe(1);
    await withCsrf(user.agent.post(`${SUBSCRIPTIONS}/${netflix.schedule.id}/cancel`), user)
      .send({})
      .expect(200);
    // The recorded charge is untouched.
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: recorded.transaction.transaction.id },
    });
    expect(transaction.voidedAt).toBeNull();

    await withCsrf(user.agent.post(`${SUBSCRIPTIONS}/${netflix.schedule.id}/archive`), user).expect(
      200,
    );
    const current = apiSuccessResponseSchema(subscriptionListDtoSchema).parse(
      (await user.agent.get(SUBSCRIPTIONS).expect(200)).body,
    ).data;
    expect(current.subscriptions.map((entry) => entry.schedule.name)).toEqual(['Cloud']);
    const archived = apiSuccessResponseSchema(subscriptionListDtoSchema).parse(
      (await user.agent.get(`${SUBSCRIPTIONS}?status=archived`).expect(200)).body,
    ).data;
    expect(archived.subscriptions[0]?.status).toBe('archived');
  });

  it('only manages subscriptions, and only the caller’s', async () => {
    const context = createContext();
    const user = await newUser(context);
    const today = calendarDateInTimeZone(context.clock.now(), 'Asia/Kolkata');
    const rent = await withCsrf(user.agent.post(RECURRING), user)
      .send({
        name: 'Rent',
        type: 'expense',
        amountMinor: '100000',
        currency: 'INR',
        frequency: 'monthly',
        startDate: today,
      })
      .expect(201);
    const rentId = apiSuccessResponseSchema(subscriptionDtoSchema.pick({ schedule: true })).parse(
      rent.body,
    ).data.schedule.id;
    await user.agent.get(`${SUBSCRIPTIONS}/${rentId}`).expect(404);
    await withCsrf(user.agent.post(`${SUBSCRIPTIONS}/${rentId}/cancel`), user)
      .send({})
      .expect(404);

    const mine = await subscribe(user, {
      name: 'Music',
      amountMinor: '11900',
      currency: 'INR',
      frequency: 'monthly',
      startDate: today,
    });
    const other = await newUser(createContext());
    await other.agent.get(`${SUBSCRIPTIONS}/${mine.schedule.id}`).expect(404);
    await withCsrf(other.agent.post(`${SUBSCRIPTIONS}/${mine.schedule.id}/pause`), other).expect(
      404,
    );
    const rejected = await withCsrf(user.agent.post(SUBSCRIPTIONS), user)
      .send({
        name: 'Salary',
        type: 'income',
        amountMinor: '1',
        currency: 'INR',
        frequency: 'monthly',
        startDate: today,
      })
      .expect(400);
    expect(parseError(rejected.body).code).toBe('VALIDATION_ERROR');
  });
});

describe('savings goals', () => {
  it('tracks allocations exactly without touching accounts or transactions', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = (
      await createAccount(user, {
        name: 'HDFC',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '1000000',
      })
    ).account.id;
    const created = await withCsrf(user.agent.post(GOALS), user)
      .send({
        name: 'Emergency fund',
        targetMinor: '30000000',
        currency: 'INR',
        initialSavedMinor: '5000000',
      })
      .expect(201);
    const goal: SavingsGoalDetailDto = goalEnvelope.parse(created.body).data;
    expect(goal.progress).toMatchObject({
      savedMinor: '5000000',
      remainingMinor: '25000000',
      percent: { status: 'available', basisPoints: '1667' },
      reached: false,
      contributionCount: 1,
    });

    const contribute = (body: Record<string, unknown>): ReturnType<typeof withCsrf> =>
      withCsrf(user.agent.post(`${GOALS}/${goal.goal.id}/contributions`), user).send(body);

    await contribute({ kind: 'add', amountMinor: '1000000' }).expect(201);
    await contribute({ kind: 'withdraw', amountMinor: '7000000' }).expect(400); // only 60,000 tracked
    const set = goalEnvelope.parse(
      (await contribute({ kind: 'set', savedMinor: '33000000', note: 'Bonus' }).expect(201)).body,
    ).data;
    // Exceeding the target is shown as it is: over 100 % and a negative remainder.
    expect(set.progress).toMatchObject({
      savedMinor: '33000000',
      remainingMinor: '-3000000',
      percent: { status: 'available', basisPoints: '11000' },
      reached: true,
    });
    expect(set.goal.status).toBe('active');
    expect(set.contributions[0]).toMatchObject({ amountMinor: '27000000', note: 'Bonus' });

    // Two allocations at once both count (the goal row is locked for each).
    await Promise.all([
      contribute({ kind: 'add', amountMinor: '100' }),
      contribute({ kind: 'add', amountMinor: '200' }),
    ]);
    const detail = goalEnvelope.parse(
      (await user.agent.get(`${GOALS}/${goal.goal.id}`).expect(200)).body,
    ).data;
    expect(detail.progress.savedMinor).toBe('33000300');

    const completed = goalEnvelope.parse(
      (await withCsrf(user.agent.post(`${GOALS}/${goal.goal.id}/complete`), user).expect(200)).body,
    ).data;
    expect(completed.goal.status).toBe('completed');
    await contribute({ kind: 'add', amountMinor: '1' }).expect(409);
    await withCsrf(user.agent.patch(`${GOALS}/${goal.goal.id}`), user)
      .send({ currency: 'USD' })
      .expect(400);
    await withCsrf(user.agent.post(`${GOALS}/${goal.goal.id}/archive`), user).expect(200);
    const archived = apiSuccessResponseSchema(savingsGoalListDtoSchema).parse(
      (await user.agent.get(`${GOALS}?status=archived`).expect(200)).body,
    ).data;
    expect(archived.goals[0]?.goal.status).toBe('archived');
    expect(
      apiSuccessResponseSchema(savingsGoalListDtoSchema).parse(
        (await user.agent.get(GOALS).expect(200)).body,
      ).data.goals,
    ).toHaveLength(0);

    // Allocations are plans: no account balance moved and no transaction exists.
    expect(await balanceOf(user, bank)).toBe(1_000_000n);
    expect(await prisma.transaction.count()).toBe(0);

    const other = await newUser(createContext());
    await other.agent.get(`${GOALS}/${goal.goal.id}`).expect(404);
    await withCsrf(other.agent.post(`${GOALS}/${goal.goal.id}/contributions`), other)
      .send({ kind: 'add', amountMinor: '1' })
      .expect(404);
  });

  it('reports timing towards a target date and rejects invalid targets', async () => {
    const context = createContext();
    const user = await newUser(context);
    const today = calendarDateInTimeZone(context.clock.now(), 'Asia/Kolkata');
    const response = await withCsrf(user.agent.post(GOALS), user)
      .send({
        name: 'Laptop',
        targetMinor: '12000000',
        currency: 'INR',
        targetDate: addMonthsToIsoDate(today, 4),
      })
      .expect(201);
    expect(goalEnvelope.parse(response.body).data.progress).toMatchObject({
      savedMinor: '0',
      monthlyNeededMinor: '3000000',
    });
    await withCsrf(user.agent.post(GOALS), user)
      .send({ name: 'Nothing', targetMinor: '0', currency: 'INR' })
      .expect(400);
    await withCsrf(user.agent.post(GOALS), user)
      .send({ name: 'Rounded', targetMinor: '1.5', currency: 'INR' })
      .expect(400);
  });
});
