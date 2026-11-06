import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  occurrenceLinkCandidatesDtoSchema,
  recordedOccurrenceDtoSchema,
  recurringScheduleItemDtoSchema,
  upcomingOccurrencesDtoSchema,
  type RecurringScheduleItemDto,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { createPrismaIntelligenceRepository } from '../intelligence/intelligence.repository';
import {
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  parseError,
  record,
} from '../../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';

// Settling a scheduled payment with a transaction the person already recorded (Phase 12): the
// payment stops being overdue, no second transaction is written, and forecasts treat the money
// as the schedule's rather than as everyday spending.

const RECURRING = `${API_V1_PREFIX}/recurring`;
const TIME_ZONE = 'Asia/Kolkata';

const { prisma, createContext } = useIntegrationDatabase();
const recordedEnvelope = apiSuccessResponseSchema(recordedOccurrenceDtoSchema);
const candidatesEnvelope = apiSuccessResponseSchema(occurrenceLinkCandidatesDtoSchema);

interface Seeded {
  context: TestContext;
  user: SignedIn;
  today: string;
  bank: string;
  usd: string;
  rent: string;
  salary: string;
  schedule: RecurringScheduleItemDto;
  /** The first (overdue) occurrence of the rent schedule. */
  due: string;
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
  const usd = (
    await createAccount(user, {
      name: 'Travel card',
      type: 'bank',
      currency: 'USD',
      openingBalanceMinor: '100000',
      ...opened,
    })
  ).account.id;
  const rent = await categoryId(user, 'expense', 'Rent');
  const due = addDaysToIsoDate(today, -10);
  const response = await withCsrf(user.agent.post(RECURRING), user).send({
    name: 'Rent',
    type: 'expense',
    amountMinor: '2500000',
    accountId: bank,
    categoryId: rent,
    frequency: 'monthly',
    startDate: due,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return {
    context,
    user,
    today,
    bank,
    usd,
    rent,
    salary: await categoryId(user, 'income', 'Salary'),
    schedule: apiSuccessResponseSchema(recurringScheduleItemDtoSchema).parse(response.body).data,
    due,
  };
}

function path(s: Seeded, action: string, date = s.due): string {
  return `${RECURRING}/${s.schedule.schedule.id}/occurrences/${date}/${action}`;
}

/** An ordinary expense, recorded the way a person (or a statement import) would. */
async function payRent(
  s: Seeded,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const item = await record(s.user, {
    type: 'expense',
    accountId: s.bank,
    amountMinor: '2500000',
    occurredAt: `${addDaysToIsoDate(s.due, 2)}T06:00:00.000Z`,
    description: 'Rent transfer to landlord',
    categoryId: s.rent,
    ...overrides,
  });
  return { id: item.transaction.id };
}

function link(s: Seeded, transactionId: string, date = s.due): ReturnType<typeof withCsrf> {
  return withCsrf(s.user.agent.post(path(s, 'link', date)), s.user).send({ transactionId });
}

async function overdueDates(s: Seeded): Promise<string[]> {
  const response = await s.user.agent.get(`${RECURRING}/upcoming`).expect(200);
  return apiSuccessResponseSchema(upcomingOccurrencesDtoSchema)
    .parse(response.body)
    .data.items.filter((item) => item.occurrence.status === 'overdue')
    .map((item) => item.occurrence.scheduledDate);
}

describe('linking an existing transaction to a scheduled payment', () => {
  it('settles the occurrence without a second transaction or any balance change', async () => {
    const s = await seed();
    const paid = await payRent(s);
    const before = await balanceOf(s.user, s.bank);
    expect(await overdueDates(s)).toContain(s.due);

    const response = await link(s, paid.id).expect(201);
    const result = recordedEnvelope.parse(response.body).data;

    expect(result.occurrence).toMatchObject({ scheduledDate: s.due, status: 'recorded' });
    expect(result.transaction.transaction.id).toBe(paid.id);
    expect(await prisma.transaction.count({ where: { userId: s.user.session.user.id } })).toBe(1);
    expect(await balanceOf(s.user, s.bank)).toBe(before);
    expect(await overdueDates(s)).not.toContain(s.due);
    const row = await prisma.scheduledOccurrence.findUniqueOrThrow({
      where: { transactionId: paid.id },
    });
    expect(row).toMatchObject({ state: 'recorded', scheduleId: s.schedule.schedule.id });
  });

  it('is idempotent for the same transaction and refuses a different one', async () => {
    const s = await seed();
    const paid = await payRent(s);
    const other = await payRent(s, { description: 'Second payment' });

    await link(s, paid.id).expect(201);
    const replay = await link(s, paid.id).expect(200);
    expect(recordedEnvelope.parse(replay.body).data.transaction.transaction.id).toBe(paid.id);

    const refused = await link(s, other.id).expect(409);
    expect(parseError(refused.body).code).toBe('CONFLICT');
    expect(await prisma.scheduledOccurrence.count()).toBe(1);
  });

  it('refuses transactions that cannot be this payment', async () => {
    const s = await seed();
    const income = await record(s.user, {
      type: 'income',
      accountId: s.bank,
      amountMinor: '2500000',
      occurredAt: `${s.due}T06:00:00.000Z`,
      description: 'Salary',
      categoryId: s.salary,
    });
    const dollars = await payRent(s, { accountId: s.usd, amountMinor: '30000' });
    const tooEarly = await payRent(s, {
      occurredAt: `${addDaysToIsoDate(s.due, -60)}T06:00:00.000Z`,
    });
    const voided = await payRent(s);
    await withCsrf(s.user.agent.post(`${API_V1_PREFIX}/transactions/${voided.id}/void`), s.user)
      .send({ reason: 'Duplicate' })
      .expect(200);

    for (const id of [income.transaction.id, dollars.id, tooEarly.id, voided.id]) {
      const refused = await link(s, id).expect(400);
      expect(parseError(refused.body).details?.[0]?.path).toBe('body.transactionId');
    }

    // Someone else's transaction is indistinguishable from one that does not exist.
    const stranger = await newUser(s.context);
    const theirs = (
      await createAccount(stranger, {
        name: 'Theirs',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '1000000',
        openingBalanceDate: addMonthsToIsoDate(s.today, -6),
      })
    ).account.id;
    const foreign = await record(stranger, {
      type: 'expense',
      accountId: theirs,
      amountMinor: '2500000',
      occurredAt: `${s.due}T06:00:00.000Z`,
      description: 'Their rent',
      categoryId: await categoryId(stranger, 'expense', 'Rent'),
    });
    const hidden = await link(s, foreign.transaction.id).expect(400);
    expect(parseError(hidden.body).details?.[0]?.message).toBe('Choose one of your transactions.');
    expect(await prisma.scheduledOccurrence.count()).toBe(0);
  });

  it('refuses a transaction that already settles another payment', async () => {
    const s = await seed();
    const paid = await payRent(s);
    await link(s, paid.id).expect(201);

    const next = addMonthsToIsoDate(s.due, 1);
    const refused = await link(s, paid.id, next).expect(409);
    expect(parseError(refused.body).message).toBe(
      'That transaction already settles another scheduled payment.',
    );
  });

  it('links one transaction exactly once under concurrent requests', async () => {
    const s = await seed();
    const paid = await payRent(s);
    const next = addMonthsToIsoDate(s.due, 1);

    const responses = await Promise.all([link(s, paid.id), link(s, paid.id, next)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.scheduledOccurrence.count({ where: { transactionId: paid.id } })).toBe(1);
  });

  it('offers matching transactions, closest first, and none once settled', async () => {
    const s = await seed();
    const exact = await payRent(s);
    const partial = await payRent(s, { amountMinor: '2000000', description: 'Part payment' });
    await payRent(s, { accountId: s.usd, amountMinor: '30000' });
    const linkedElsewhere = await payRent(s);
    await link(s, linkedElsewhere.id, addMonthsToIsoDate(s.due, 1)).expect(201);

    const response = await s.user.agent.get(path(s, 'link-candidates')).expect(200);
    const ids = candidatesEnvelope
      .parse(response.body)
      .data.candidates.map((item) => item.transaction.id);
    expect(ids).toEqual([exact.id, partial.id]);

    await link(s, exact.id).expect(201);
    const after = await s.user.agent.get(path(s, 'link-candidates')).expect(200);
    expect(candidatesEnvelope.parse(after.body).data.candidates).toEqual([]);
  });

  it('ranks the closest amount first even among many newer small payments', async () => {
    const s = await seed();
    const rent = await payRent(s, { occurredAt: `${addDaysToIsoDate(s.due, -20)}T06:00:00.000Z` });
    for (let index = 0; index < 55; index += 1) {
      await payRent(s, { amountMinor: '1500', description: `Snack ${String(index)}` });
    }

    const response = await s.user.agent.get(path(s, 'link-candidates')).expect(200);
    const candidates = candidatesEnvelope.parse(response.body).data.candidates;
    expect(candidates).toHaveLength(10);
    expect(candidates[0]?.transaction.id).toBe(rent.id);
  });

  it('stops counting the payment as everyday spending in forecasts', async () => {
    const s = await seed();
    const paid = await payRent(s);
    const intelligence = createPrismaIntelligenceRepository(prisma);
    const window = {
      start: new Date(`${addDaysToIsoDate(s.due, -40)}T00:00:00.000Z`),
      end: new Date(`${addDaysToIsoDate(s.today, 1)}T00:00:00.000Z`),
    };
    const scheduledFlags = async (): Promise<boolean[]> =>
      (await intelligence.monthlyTotals(s.user.session.user.id, 'INR', window, TIME_ZONE))
        .filter((row) => row.type === 'expense')
        .map((row) => row.scheduled);

    expect(await scheduledFlags()).toEqual([false]);
    await link(s, paid.id).expect(201);
    expect(await scheduledFlags()).toEqual([true]);
  });
});
