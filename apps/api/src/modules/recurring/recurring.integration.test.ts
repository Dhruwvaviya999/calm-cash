import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  occurrenceActionResultDtoSchema,
  recordedOccurrenceDtoSchema,
  recurringScheduleDetailDtoSchema,
  recurringScheduleItemDtoSchema,
  upcomingOccurrencesDtoSchema,
  type RecurringScheduleItemDto,
  type UpcomingOccurrencesDto,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNTS,
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  parseError,
  TRANSACTIONS,
} from '../../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';

const RECURRING = `${API_V1_PREFIX}/recurring`;
const TIME_ZONE = 'Asia/Kolkata';

const { prisma, createContext } = useIntegrationDatabase();
const itemEnvelope = apiSuccessResponseSchema(recurringScheduleItemDtoSchema);
const recordedEnvelope = apiSuccessResponseSchema(recordedOccurrenceDtoSchema);
const actionEnvelope = apiSuccessResponseSchema(occurrenceActionResultDtoSchema);

interface Seeded {
  context: TestContext;
  user: SignedIn;
  today: string;
  bank: string;
  cash: string;
  rent: string;
  salary: string;
}

async function seed(): Promise<Seeded> {
  const context = createContext();
  const user = await newUser(context);
  const today = calendarDateInTimeZone(context.clock.now(), TIME_ZONE);
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
  const cash = (
    await createAccount(user, {
      name: 'Wallet',
      type: 'cash',
      currency: 'INR',
      openingBalanceMinor: '10000',
      ...opened,
    })
  ).account.id;
  return {
    context,
    user,
    today,
    bank,
    cash,
    rent: await categoryId(user, 'expense', 'Rent'),
    salary: await categoryId(user, 'income', 'Salary'),
  };
}

async function createSchedule(
  user: SignedIn,
  body: Record<string, unknown>,
): Promise<RecurringScheduleItemDto> {
  const response = await withCsrf(user.agent.post(RECURRING), user).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return itemEnvelope.parse(response.body).data;
}

async function upcoming(user: SignedIn, query = ''): Promise<UpcomingOccurrencesDto> {
  const response = await user.agent.get(`${RECURRING}/upcoming${query}`).expect(200);
  return apiSuccessResponseSchema(upcomingOccurrencesDtoSchema).parse(response.body).data;
}

function occurrencePath(scheduleId: string, date: string, action: string): string {
  return `${RECURRING}/${scheduleId}/occurrences/${date}/${action}`;
}

async function transactionCount(user: SignedIn): Promise<number> {
  return prisma.transaction.count({ where: { userId: user.session.user.id } });
}

describe('recurring schedules', () => {
  it('lists overdue and upcoming occurrences and records one real transaction exactly once', async () => {
    const seeded = await seed();
    const { user, today, bank } = seeded;
    const start = addDaysToIsoDate(today, -40);
    const rent = await createSchedule(user, {
      name: 'Rent',
      type: 'expense',
      amountMinor: '2500000',
      accountId: bank,
      categoryId: seeded.rent,
      merchant: 'Landlord',
      frequency: 'monthly',
      startDate: start,
    });
    expect(rent.schedule).toMatchObject({ currency: 'INR', status: 'active', interval: 1 });
    expect(rent.nextOccurrence).toMatchObject({ scheduledDate: start, status: 'overdue' });

    const second = addMonthsToIsoDate(start, 1);
    const third = addMonthsToIsoDate(start, 2);
    const listed = await upcoming(user);
    expect(
      listed.items.map((item) => [item.occurrence.scheduledDate, item.occurrence.status]),
    ).toEqual(
      [
        [start, 'overdue'],
        [second, second < today ? 'overdue' : second === today ? 'due' : 'upcoming'],
        [third, 'upcoming'],
      ].filter(([date]) => date !== undefined && date <= addDaysToIsoDate(today, 30)),
    );
    expect(listed.pendingTotals[0]?.currency).toBe('INR');
    // A plan is not money: nothing was recorded and the balance did not move.
    expect(await transactionCount(user)).toBe(0);
    expect(await balanceOf(user, bank)).toBe(10_000_000n);

    const response = await withCsrf(
      user.agent.post(occurrencePath(rent.schedule.id, start, 'record')),
      user,
    ).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const recorded = recordedEnvelope.parse(response.body).data;
    expect(recorded.transaction.transaction).toMatchObject({
      type: 'expense',
      amountMinor: '2500000',
      description: 'Rent',
      accountId: bank,
    });
    expect(recorded.occurrence).toMatchObject({
      status: 'recorded',
      transactionId: recorded.transaction.transaction.id,
    });
    expect(recorded.schedule.schedule.nextOccurrenceDate).toBe(second);
    expect(await balanceOf(user, bank)).toBe(7_500_000n);

    // Repeating the confirmation returns the first transaction instead of paying rent twice.
    const again = await withCsrf(
      user.agent.post(occurrencePath(rent.schedule.id, start, 'record')),
      user,
    )
      .send({})
      .expect(200);
    expect(recordedEnvelope.parse(again.body).data.transaction.transaction.id).toBe(
      recorded.transaction.transaction.id,
    );
    expect(await transactionCount(user)).toBe(1);
    expect(await balanceOf(user, bank)).toBe(7_500_000n);

    // Voiding the transaction keeps the occurrence recorded (restoring it is the way back).
    await withCsrf(
      user.agent.post(`${TRANSACTIONS}/${recorded.transaction.transaction.id}/void`),
      user,
    ).expect(200);
    const detail = apiSuccessResponseSchema(recurringScheduleDetailDtoSchema).parse(
      (await user.agent.get(`${RECURRING}/${rent.schedule.id}`).expect(200)).body,
    ).data;
    expect(detail.history[0]).toMatchObject({ status: 'recorded', transactionStatus: 'voided' });
  });

  it('skips, restores, and postpones occurrences without duplicates', async () => {
    const seeded = await seed();
    const { user, today, bank } = seeded;
    const start = addDaysToIsoDate(today, -10);
    const bill = await createSchedule(user, {
      name: 'Internet',
      type: 'expense',
      amountMinor: '99900',
      accountId: bank,
      categoryId: seeded.rent,
      frequency: 'monthly',
      startDate: start,
    });
    const next = addMonthsToIsoDate(start, 1);

    const skipped = actionEnvelope.parse(
      (
        await withCsrf(
          user.agent.post(occurrencePath(bill.schedule.id, start, 'skip')),
          user,
        ).expect(200)
      ).body,
    ).data;
    expect(skipped.occurrence.status).toBe('skipped');
    expect(skipped.schedule.schedule.nextOccurrenceDate).toBe(next);
    await withCsrf(user.agent.post(occurrencePath(bill.schedule.id, start, 'skip')), user).expect(
      200,
    );

    const refused = await withCsrf(
      user.agent.post(occurrencePath(bill.schedule.id, start, 'record')),
      user,
    )
      .send({})
      .expect(409);
    expect(parseError(refused.body).code).toBe('CONFLICT');
    expect(await transactionCount(user)).toBe(0);

    const unskipped = actionEnvelope.parse(
      (
        await withCsrf(
          user.agent.post(occurrencePath(bill.schedule.id, start, 'unskip')),
          user,
        ).expect(200)
      ).body,
    ).data;
    expect(unskipped.occurrence.status).toBe('overdue');
    expect(unskipped.schedule.schedule.nextOccurrenceDate).toBe(start);

    const later = addDaysToIsoDate(today, 5);
    const postponed = actionEnvelope.parse(
      (
        await withCsrf(user.agent.post(occurrencePath(bill.schedule.id, start, 'postpone')), user)
          .send({ dueDate: later })
          .expect(200)
      ).body,
    ).data;
    expect(postponed.occurrence).toMatchObject({
      scheduledDate: start,
      dueDate: later,
      status: 'upcoming',
      postponed: true,
    });
    await withCsrf(user.agent.post(occurrencePath(bill.schedule.id, start, 'postpone')), user)
      .send({ dueDate: today })
      .expect(400);
    // A date the rule never falls on is not an occurrence.
    await withCsrf(
      user.agent.post(occurrencePath(bill.schedule.id, addDaysToIsoDate(start, 1), 'skip')),
      user,
    ).expect(404);
    expect(await prisma.scheduledOccurrence.count()).toBe(1);
  });

  it('lets only one of many simultaneous confirmations record the payment', async () => {
    const seeded = await seed();
    const { user, today, bank } = seeded;
    const salary = await createSchedule(user, {
      name: 'Salary',
      type: 'income',
      amountMinor: '8500000',
      accountId: bank,
      categoryId: seeded.salary,
      frequency: 'monthly',
      startDate: today,
    });
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        withCsrf(user.agent.post(occurrencePath(salary.schedule.id, today, 'record')), user).send(
          {},
        ),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 201]);
    const ids = new Set(
      responses.map(
        (response) => recordedEnvelope.parse(response.body).data.transaction.transaction.id,
      ),
    );
    expect(ids.size).toBe(1);
    expect(await transactionCount(user)).toBe(1);
    expect(await prisma.scheduledOccurrence.count({ where: { state: 'recorded' } })).toBe(1);
    expect(await balanceOf(user, bank)).toBe(18_500_000n);
  });

  it('keeps account rules: archived accounts and cash overdrafts are refused, nothing changes', async () => {
    const seeded = await seed();
    const { user, today, cash, bank } = seeded;
    const groceries = await createSchedule(user, {
      name: 'Big shop',
      type: 'expense',
      amountMinor: '50000', // 500.00 from a wallet holding 100.00
      accountId: cash,
      categoryId: seeded.rent,
      frequency: 'weekly',
      startDate: today,
    });
    const overdraft = await withCsrf(
      user.agent.post(occurrencePath(groceries.schedule.id, today, 'record')),
      user,
    )
      .send({})
      .expect(409);
    expect(parseError(overdraft.body).code).toBe('CONFLICT');
    expect(await balanceOf(user, cash)).toBe(10_000n);
    expect(await transactionCount(user)).toBe(0);
    expect(await prisma.scheduledOccurrence.count()).toBe(0);

    const spare = (
      await createAccount(user, {
        name: 'Old bank',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '100000',
      })
    ).account.id;
    await withCsrf(user.agent.post(`${ACCOUNTS}/${spare}/archive`), user).expect(200);
    const archived = await withCsrf(
      user.agent.post(occurrencePath(groceries.schedule.id, today, 'record')),
      user,
    ).send({ accountId: spare });
    expect(archived.status).toBe(400);
    expect(await transactionCount(user)).toBe(0);

    // Another account in another currency cannot settle an INR payment.
    const usd = (
      await createAccount(user, {
        name: 'US',
        type: 'bank',
        currency: 'USD',
        openingBalanceMinor: '100000',
      })
    ).account.id;
    await withCsrf(user.agent.post(occurrencePath(groceries.schedule.id, today, 'record')), user)
      .send({ accountId: usd })
      .expect(400);
    // The bank can pay it.
    await withCsrf(user.agent.post(occurrencePath(groceries.schedule.id, today, 'record')), user)
      .send({ accountId: bank })
      .expect(201);
    expect(await balanceOf(user, bank)).toBe(9_950_000n);
  });

  it('rolls the transaction back when marking the occurrence fails', async () => {
    const context = createContext({
      recurringRepository: (real) => ({
        ...real,
        storeFor: (db) => ({
          ...real.storeFor(db),
          putOccurrence: () => Promise.reject(new Error('Simulated failure')),
        }),
      }),
    });
    const user = await newUser(context);
    const today = calendarDateInTimeZone(context.clock.now(), TIME_ZONE);
    const bank = (
      await createAccount(user, {
        name: 'HDFC',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '1000000',
      })
    ).account.id;
    const schedule = await createSchedule(user, {
      name: 'Gym',
      type: 'expense',
      amountMinor: '150000',
      accountId: bank,
      categoryId: await categoryId(user, 'expense', 'Health'),
      frequency: 'monthly',
      startDate: today,
    });
    await withCsrf(user.agent.post(occurrencePath(schedule.schedule.id, today, 'record')), user)
      .send({})
      .expect(500);
    expect(await transactionCount(user)).toBe(0);
    expect(await balanceOf(user, bank)).toBe(1_000_000n);
    const after = await prisma.recurringSchedule.findUniqueOrThrow({
      where: { id: schedule.schedule.id },
    });
    expect(after.nextOccurrenceDate?.toISOString().slice(0, 10)).toBe(today);
  });

  it('pauses and resumes: payments that fell during the pause are not owed', async () => {
    const seeded = await seed();
    const { user, today, bank } = seeded;
    const weekly = await createSchedule(user, {
      name: 'Cleaner',
      type: 'expense',
      amountMinor: '60000',
      accountId: bank,
      categoryId: seeded.rent,
      frequency: 'weekly',
      startDate: addDaysToIsoDate(today, -21),
    });
    const paused = itemEnvelope.parse(
      (
        await withCsrf(user.agent.post(`${RECURRING}/${weekly.schedule.id}/pause`), user).expect(
          200,
        )
      ).body,
    ).data;
    expect(paused.schedule.status).toBe('paused');
    expect((await upcoming(user)).items).toHaveLength(0);
    // Pretend the pause began ten days ago (the session would expire if the clock moved).
    const nowMs = seeded.context.clock.now().getTime();
    await prisma.recurringSchedule.update({
      where: { id: weekly.schedule.id },
      data: {
        createdAt: new Date(nowMs - 30 * 86_400_000),
        pausedAt: new Date(nowMs - 10 * 86_400_000),
      },
    });
    await withCsrf(user.agent.post(`${RECURRING}/${weekly.schedule.id}/resume`), user).expect(200);

    const statuses = new Map(
      (
        await upcoming(
          user,
          `?from=${addDaysToIsoDate(today, -30)}&to=${addDaysToIsoDate(today, 10)}`,
        )
      ).items.map((item) => [item.occurrence.scheduledDate, item.occurrence.status]),
    );
    expect(statuses.get(addDaysToIsoDate(today, -21))).toBe('overdue'); // owed before the pause
    expect(statuses.get(addDaysToIsoDate(today, -14))).toBe('overdue');
    expect(statuses.get(addDaysToIsoDate(today, -7))).toBe('paused'); // fell during the pause
    expect(statuses.get(today)).toBe('due');
    expect(await transactionCount(user)).toBe(0);
  });

  it('changes future occurrences only and never rewrites recorded transactions', async () => {
    const seeded = await seed();
    const { user, today, bank } = seeded;
    const start = addDaysToIsoDate(today, -1);
    const schedule = await createSchedule(user, {
      name: 'Phone',
      type: 'expense',
      amountMinor: '59900',
      accountId: bank,
      categoryId: seeded.rent,
      frequency: 'monthly',
      startDate: start,
    });
    const recorded = recordedEnvelope.parse(
      (
        await withCsrf(user.agent.post(occurrencePath(schedule.schedule.id, start, 'record')), user)
          .send({})
          .expect(201)
      ).body,
    ).data;
    const updated = itemEnvelope.parse(
      (
        await withCsrf(user.agent.patch(`${RECURRING}/${schedule.schedule.id}`), user)
          .send({ amountMinor: '79900', name: 'Phone plan' })
          .expect(200)
      ).body,
    ).data;
    expect(updated.nextOccurrence).toMatchObject({ amountMinor: '79900' });
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: recorded.transaction.transaction.id },
    });
    expect(transaction.amountMinor).toBe(59_900n);
    expect(transaction.description).toBe('Phone');

    // New timing must start after recorded history.
    await withCsrf(user.agent.patch(`${RECURRING}/${schedule.schedule.id}`), user)
      .send({ startDate: start, frequency: 'weekly' })
      .expect(400);
    const retimed = itemEnvelope.parse(
      (
        await withCsrf(user.agent.patch(`${RECURRING}/${schedule.schedule.id}`), user)
          .send({ startDate: addDaysToIsoDate(today, 3), frequency: 'weekly' })
          .expect(200)
      ).body,
    ).data;
    expect(retimed.schedule.nextOccurrenceDate).toBe(addDaysToIsoDate(today, 3));

    // Ending before the first date is refused; ending after the last expected one completes it.
    await withCsrf(user.agent.post(`${RECURRING}/${schedule.schedule.id}/end`), user)
      .send({ endDate: addDaysToIsoDate(today, 2) })
      .expect(400);
    const first = addDaysToIsoDate(today, 3);
    await withCsrf(
      user.agent.post(occurrencePath(schedule.schedule.id, first, 'skip')),
      user,
    ).expect(200);
    const ended = itemEnvelope.parse(
      (
        await withCsrf(user.agent.post(`${RECURRING}/${schedule.schedule.id}/end`), user)
          .send({ endDate: addDaysToIsoDate(first, 6) })
          .expect(200)
      ).body,
    ).data;
    expect(ended.schedule.status).toBe('completed');
    expect(await transactionCount(user)).toBe(1);
  });

  it('keeps schedules private and validates references', async () => {
    const seeded = await seed();
    const { user, today, bank } = seeded;
    const schedule = await createSchedule(user, {
      name: 'Rent',
      type: 'expense',
      amountMinor: '100000',
      accountId: bank,
      frequency: 'monthly',
      startDate: today,
    });
    const other = await newUser(createContext());
    await other.agent.get(`${RECURRING}/${schedule.schedule.id}`).expect(404);
    await withCsrf(other.agent.post(occurrencePath(schedule.schedule.id, today, 'record')), other)
      .send({})
      .expect(404);
    await withCsrf(
      other.agent.post(occurrencePath(schedule.schedule.id, today, 'skip')),
      other,
    ).expect(404);
    expect((await upcoming(other)).items).toHaveLength(0);

    // Recording needs a category; an income category cannot classify an expense.
    await withCsrf(user.agent.post(occurrencePath(schedule.schedule.id, today, 'record')), user)
      .send({})
      .expect(400);
    await withCsrf(user.agent.post(RECURRING), user)
      .send({
        name: 'Wrong',
        type: 'expense',
        amountMinor: '100',
        currency: 'INR',
        categoryId: seeded.salary,
        frequency: 'monthly',
        startDate: today,
      })
      .expect(400);
    await withCsrf(user.agent.post(RECURRING), user)
      .send({
        name: 'No currency',
        type: 'expense',
        amountMinor: '100',
        frequency: 'monthly',
        startDate: today,
      })
      .expect(400);
    await withCsrf(user.agent.post(RECURRING), user)
      .send({
        name: 'Hacked',
        type: 'expense',
        amountMinor: '100',
        currency: 'INR',
        frequency: 'monthly',
        startDate: today,
        isSubscription: true,
      })
      .expect(400);
    await withCsrf(user.agent.post(RECURRING), user)
      .send({
        name: 'Too often',
        type: 'expense',
        amountMinor: '100',
        currency: 'INR',
        frequency: 'monthly',
        interval: 30,
        startDate: today,
      })
      .expect(400);
  });
});
