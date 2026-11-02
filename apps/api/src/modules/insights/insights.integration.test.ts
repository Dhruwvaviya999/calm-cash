import {
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  calendarDateInTimeZone,
  insightExplanationDtoSchema,
  insightListDtoSchema,
  recurringCandidateListDtoSchema,
  type InsightListDto,
  type RecurringCandidateListDto,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { categoryId, createAccount, newUser, record } from '../../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';

const { createContext } = useIntegrationDatabase();

const INSIGHTS = `${API_V1_PREFIX}/insights`;
const MARCH_QUERY = 'period=custom&from=2026-03-01&to=2026-03-31';
const DAY = 86_400_000;

async function insights(user: SignedIn, query = MARCH_QUERY): Promise<InsightListDto> {
  const response = await user.agent.get(`${INSIGHTS}?${query}`).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return apiSuccessResponseSchema(insightListDtoSchema).parse(response.body).data;
}

async function candidates(user: SignedIn): Promise<RecurringCandidateListDto> {
  const response = await user.agent.get(`${INSIGHTS}/recurring-candidates`).expect(200);
  return apiSuccessResponseSchema(recurringCandidateListDtoSchema).parse(response.body).data;
}

async function bankOf(user: SignedIn): Promise<string> {
  return (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '0',
      openingBalanceDate: '2025-01-01',
    })
  ).account.id;
}

async function spend(
  user: SignedIn,
  accountId: string,
  category: string,
  amountMinor: string,
  occurredAt: string,
  merchant = 'FreshMart',
): Promise<void> {
  await record(user, {
    type: 'expense',
    accountId,
    amountMinor,
    occurredAt,
    description: `${merchant} payment`,
    merchant,
    categoryId: category,
  });
}

describe('spending insights', () => {
  it('compares a period with the one before, in plain words that never guess why', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await bankOf(user);
    const groceries = await categoryId(user, 'expense', 'Groceries');
    await spend(user, bank, groceries, '200000', '2026-02-05T06:00:00.000Z');
    await spend(user, bank, groceries, '200000', '2026-02-20T06:00:00.000Z');
    await spend(user, bank, groceries, '450000', '2026-03-05T06:00:00.000Z');
    await spend(user, bank, groceries, '750000', '2026-03-20T06:00:00.000Z');

    const list = await insights(user);

    const key = `up:INR:2026-03-01:${groceries}`;
    expect(list).toMatchObject({ currency: 'INR', period: { from: '2026-03-01' } });
    expect(list.items).toContainEqual(
      expect.objectContaining({
        key,
        kind: 'category_increase',
        title: 'Groceries spending rose by 200%',
        figures: [
          expect.objectContaining({ amountMinor: '1200000' }),
          expect.objectContaining({ amountMinor: '400000' }),
          { label: 'Change', text: '+200%' },
        ],
        link: {
          label: 'View Groceries expenses',
          target: {
            kind: 'transactions',
            filters: {
              type: 'expense',
              currency: 'INR',
              from: '2026-03-01',
              to: '2026-03-31',
              categoryId: groceries,
            },
          },
        },
      }),
    );
    expect(list.items.find((item) => item.key === key)?.detail).toContain(
      'it does not say why they changed',
    );

    // The assistant may explain it, but only with the insight's own numbers.
    context.ai.reply({
      answer: 'Groceries spending rose by 200%: ₹12,000.00 against ₹4,000.00.',
      followUps: [],
    });
    const explained = await withCsrf(
      user.agent.post(`${API_V1_PREFIX}/ai/insight-explanations`),
      user,
    )
      .send({ key, period: 'custom', from: '2026-03-01', to: '2026-03-31' })
      .expect(200);
    expect(
      apiSuccessResponseSchema(insightExplanationDtoSchema).parse(explained.body).data,
    ).toEqual({
      key,
      explanation: 'Groceries spending rose by 200%: ₹12,000.00 against ₹4,000.00.',
      narrative: 'assistant',
    });

    // Dismissed insights stay hidden for this person only.
    const other = await newUser(context);
    await withCsrf(user.agent.post(`${INSIGHTS}/${encodeURIComponent(key)}/dismiss`), user).expect(
      200,
    );
    expect((await insights(user)).items.map((item) => item.key)).not.toContain(key);
    expect((await insights(other)).items).toEqual([]);
  });

  it('notes an unusually large expense without calling it fraud', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await bankOf(user);
    const groceries = await categoryId(user, 'expense', 'Groceries');
    for (let index = 0; index < 9; index += 1) {
      const day = (index + 1).toString().padStart(2, '0');
      await spend(user, bank, groceries, '50000', `2026-01-${day}T06:00:00.000Z`);
    }
    await spend(user, bank, groceries, '600000', '2026-03-10T06:00:00.000Z', 'Big Bazaar');

    const unusual = (await insights(user)).items.find((item) => item.kind === 'unusual_expense');

    expect(unusual).toMatchObject({
      title: 'A larger than usual Groceries payment',
      figures: [
        { label: 'This payment', amountMinor: '600000' },
        { label: 'Typical in this category', amountMinor: '50000' },
      ],
      link: { target: { kind: 'transaction' } },
    });
    expect(unusual?.detail).toContain('about 12.0 times');
    expect(unusual?.detail).toContain('not a sign of fraud');
  });

  it('says when there is too little history to compare', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await bankOf(user);
    await spend(
      user,
      bank,
      await categoryId(user, 'expense', 'Groceries'),
      '10000',
      '2026-03-10T06:00:00.000Z',
    );

    expect(await insights(user)).toMatchObject({ items: [], insufficientHistory: true });
  });
});

describe('recurring payment candidates', () => {
  async function monthlyNetflix(
    context: TestContext,
    user: SignedIn,
    bank: string,
    category: string,
  ): Promise<void> {
    const now = context.clock.now().getTime();
    for (const daysAgo of [95, 65, 35, 5]) {
      await spend(
        user,
        bank,
        category,
        '64900',
        new Date(now - daysAgo * DAY).toISOString(),
        'Netflix',
      );
    }
  }

  it('suggests a repeating payment with its evidence, and never creates a schedule', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await bankOf(user);
    const streaming = await categoryId(user, 'expense', 'Streaming');
    await monthlyNetflix(context, user, bank, streaming);

    const { items } = await candidates(user);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'rc:INR:netflix',
      label: 'Netflix',
      merchant: 'Netflix',
      currency: 'INR',
      typicalAmountMinor: '64900',
      frequency: 'monthly',
      occurrences: 4,
      accountId: bank,
      categoryId: streaming,
      strength: 'possible',
      likelySubscription: true,
    });
    expect(items[0]?.evidence).toContain('4 payments, 3 of 3 gaps fit a monthly rhythm');
    expect(items[0]?.transactionIds).toHaveLength(4);
    const recurring = await user.agent.get(`${API_V1_PREFIX}/recurring`).expect(200);
    expect(JSON.stringify(recurring.body)).not.toContain('Netflix');
  });

  it('hides dismissed candidates and payments that already have a schedule', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await bankOf(user);
    const streaming = await categoryId(user, 'expense', 'Streaming');
    await monthlyNetflix(context, user, bank, streaming);
    const other = await newUser(context);
    const otherBank = await bankOf(other);
    await monthlyNetflix(
      context,
      other,
      otherBank,
      await categoryId(other, 'expense', 'Streaming'),
    );

    await withCsrf(
      user.agent.post(`${INSIGHTS}/recurring-candidates/rc%3AINR%3Anetflix/dismiss`),
      user,
    ).expect(200);
    expect((await candidates(user)).items).toEqual([]);
    // Another person's candidates are their own.
    expect((await candidates(other)).items).toHaveLength(1);

    // Once the person schedules it themselves, it is no longer suggested.
    const today = calendarDateInTimeZone(context.clock.now(), other.session.user.timezone);
    await withCsrf(other.agent.post(`${API_V1_PREFIX}/recurring`), other)
      .send({
        name: 'Netflix',
        type: 'expense',
        amountMinor: '64900',
        accountId: otherBank,
        merchant: 'Netflix',
        frequency: 'monthly',
        startDate: today,
      })
      .expect(201);
    expect((await candidates(other)).items).toEqual([]);
  });

  it('rejects malformed keys', async () => {
    const context = createContext();
    const user = await newUser(context);

    await withCsrf(
      user.agent.post(`${INSIGHTS}/recurring-candidates/${'x'.repeat(300)}/dismiss`),
      user,
    ).expect(400);
    await withCsrf(user.agent.post(`${INSIGHTS}/bad%20key%3Cscript%3E/dismiss`), user).expect(400);
  });
});
