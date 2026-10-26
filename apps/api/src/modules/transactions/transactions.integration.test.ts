import {
  apiSuccessResponseSchema,
  bulkTransactionResultDtoSchema,
  reconciliationPreviewDtoSchema,
  transactionPageDtoSchema,
  transactionSummaryDtoSchema,
  type ReconciliationPreviewDto,
  type TransactionPageDto,
  type TransactionSummaryDto,
} from '@calmcash/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNTS,
  balanceOf,
  categoryId,
  createAccount,
  getAccount,
  hoursAgo,
  newUser,
  parseError,
  parseItem,
  postTransaction,
  record,
  TRANSACTIONS,
} from '../../testing/finance-helpers';
import {
  fromApp,
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';

const { prisma, createContext } = useIntegrationDatabase();

const OPENED = '2025-01-01';

const BANK = {
  name: 'HDFC Salary',
  type: 'bank',
  currency: 'INR',
  openingBalanceMinor: '5000000',
  openingBalanceDate: OPENED,
} as const;
const CASH = {
  name: 'Wallet cash',
  type: 'cash',
  currency: 'INR',
  openingBalanceMinor: '100000',
  openingBalanceDate: OPENED,
} as const;
const CARD = {
  name: 'Rewards Card',
  type: 'credit_card',
  currency: 'INR',
  openingBalanceMinor: '-1250000',
  creditLimitMinor: '10000000',
  openingBalanceDate: OPENED,
} as const;

interface Setup {
  context: TestContext;
  user: SignedIn;
  bank: string;
  cash: string;
  card: string;
  groceries: string;
  food: string;
  restaurants: string;
  salary: string;
}

async function setup(): Promise<Setup> {
  const context = createContext();
  const user = await newUser(context);
  const [bank, cash, card] = await Promise.all([
    createAccount(user, BANK),
    createAccount(user, CASH),
    createAccount(user, CARD),
  ]);
  return {
    context,
    user,
    bank: bank.account.id,
    cash: cash.account.id,
    card: card.account.id,
    groceries: await categoryId(user, 'expense', 'Groceries'),
    food: await categoryId(user, 'expense', 'Food'),
    restaurants: await categoryId(user, 'expense', 'Restaurants'),
    salary: await categoryId(user, 'income', 'Salary'),
  };
}

function expense(s: Setup, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'expense',
    accountId: s.bank,
    amountMinor: '245000',
    occurredAt: hoursAgo(s.context.clock.now(), 3),
    description: 'Weekly groceries',
    merchant: 'FreshMart',
    categoryId: s.groceries,
    paymentMethod: 'upi',
    tags: ['Family'],
    ...overrides,
  };
}

async function list(user: SignedIn, query = ''): Promise<TransactionPageDto> {
  const response = await user.agent.get(`${TRANSACTIONS}${query}`).expect(200);
  return apiSuccessResponseSchema(transactionPageDtoSchema).parse(response.body).data;
}

async function summary(user: SignedIn, query = ''): Promise<TransactionSummaryDto> {
  const response = await user.agent.get(`${TRANSACTIONS}/summary${query}`).expect(200);
  return apiSuccessResponseSchema(transactionSummaryDtoSchema).parse(response.body).data;
}

describe('recording income and expenses', () => {
  it('records an expense with its details and lowers the balance exactly', async () => {
    const s = await setup();

    const item = await record(s.user, expense(s));

    expect(item.transaction).toMatchObject({
      type: 'expense',
      userId: s.user.session.user.id,
      accountId: s.bank,
      amountMinor: '245000',
      currency: 'INR',
      description: 'Weekly groceries',
      merchant: 'FreshMart',
      categoryId: s.groceries,
      paymentMethod: 'upi',
      tags: ['family'],
      status: 'active',
    });
    expect(item.account).toEqual({
      id: s.bank,
      name: 'HDFC Salary',
      type: 'bank',
      currency: 'INR',
      status: 'active',
    });
    expect(item.category).toMatchObject({ id: s.groceries, name: 'Groceries', kind: 'expense' });
    expect(await balanceOf(s.user, s.bank)).toBe(5_000_000n - 245_000n);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: item.transaction.id } });
    expect(row.amountMinor).toBe(245_000n);
    expect(row.idempotencyKey).toBeNull();
  });

  it('records income with a payer and raises the balance', async () => {
    const s = await setup();

    const item = await record(s.user, {
      type: 'income',
      accountId: s.bank,
      amountMinor: '8500000',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
      description: 'October salary',
      merchant: 'Acme Corp',
      categoryId: s.salary,
    });

    expect(item.transaction).toMatchObject({ type: 'income', merchant: 'Acme Corp', tags: [] });
    expect(await balanceOf(s.user, s.bank)).toBe(13_500_000n);
  });

  it('keeps large amounts exact through the database round trip', async () => {
    const s = await setup();

    const item = await record(
      s.user,
      expense(s, { accountId: s.card, amountMinor: '999999999999999' }),
    );

    expect(item.transaction.amountMinor).toBe('999999999999999');
    const card = await getAccount(s.user, s.card);
    expect(card.balance.amountOwedMinor).toBe((999_999_999_999_999n + 1_250_000n).toString());
  });

  it('accepts subcategories and records their parent for display', async () => {
    const s = await setup();

    const item = await record(s.user, expense(s, { categoryId: s.restaurants }));

    expect(item.category).toEqual({
      id: s.restaurants,
      name: 'Restaurants',
      kind: 'expense',
      parentId: s.food,
      parentName: 'Food',
    });
  });

  it('rejects invalid combinations with field details and writes nothing', async () => {
    const s = await setup();
    const other = await newUser(s.context);
    const foreignAccount = (await createAccount(other, BANK)).account.id;
    const foreignCategory = await categoryId(other, 'expense', 'Groceries');
    const usd = (await createAccount(s.user, { ...BANK, name: 'US', currency: 'USD' })).account.id;

    const cases: [Record<string, unknown>, string, number][] = [
      [expense(s, { categoryId: s.salary }), 'body.categoryId', 400],
      [expense(s, { categoryId: foreignCategory }), 'body.categoryId', 400],
      [expense(s, { accountId: foreignAccount }), 'body.accountId', 400],
      [expense(s, { amountMinor: '0' }), 'body.amountMinor', 400],
      [expense(s, { amountMinor: '12.50' }), 'body.amountMinor', 400],
      [
        expense(s, { occurredAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
        'body.occurredAt',
        400,
      ],
      [expense(s, { occurredAt: '2024-12-31T12:00:00.000Z' }), 'body.occurredAt', 400],
      [{ ...expense(s), type: 'transfer', transferAccountId: s.cash }, 'body', 400],
      [
        {
          type: 'transfer',
          accountId: s.bank,
          transferAccountId: usd,
          amountMinor: '100',
          occurredAt: hoursAgo(s.context.clock.now(), 1),
        },
        'body.transferAccountId',
        400,
      ],
      [
        {
          type: 'transfer',
          accountId: s.bank,
          transferAccountId: s.bank,
          amountMinor: '100',
          occurredAt: hoursAgo(s.context.clock.now(), 1),
        },
        'body.transferAccountId',
        400,
      ],
    ];
    for (const [body, path, status] of cases) {
      const response = await postTransaction(s.user, body);
      expect(response.status, JSON.stringify(body)).toBe(status);
      expect(parseError(response.body).details?.map((detail) => detail.path)).toContain(path);
    }
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('rejects owner IDs, currencies, and statuses supplied by the client', async () => {
    const s = await setup();
    for (const extra of [
      { userId: s.user.session.user.id },
      { currency: 'INR' },
      { status: 'voided' },
      { id: randomUUID() },
    ]) {
      await postTransaction(s.user, expense(s, extra)).expect(400);
    }
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('refuses new transactions on archived accounts without reactivating them', async () => {
    const s = await setup();
    await withCsrf(s.user.agent.post(`${ACCOUNTS}/${s.cash}/archive`), s.user).expect(200);

    const direct = await postTransaction(
      s.user,
      expense(s, { accountId: s.cash, amountMinor: '100' }),
    );
    expect(direct.status).toBe(409);
    const transfer = await postTransaction(s.user, {
      type: 'transfer',
      accountId: s.bank,
      transferAccountId: s.cash,
      amountMinor: '100',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
    });
    expect(transfer.status).toBe(409);
    expect(parseError(transfer.body).details?.[0]?.path).toBe('body.transferAccountId');
    expect((await getAccount(s.user, s.cash)).account.status).toBe('archived');
    expect(await prisma.transaction.count()).toBe(0);
  });
});

describe('no-negative-balance accounts', () => {
  it('refuses to take cash below zero but allows a bank overdraft', async () => {
    const s = await setup();

    await record(s.user, expense(s, { accountId: s.cash, amountMinor: '100000' }));
    const tooMuch = await postTransaction(
      s.user,
      expense(s, { accountId: s.cash, amountMinor: '1' }),
    );
    expect(tooMuch.status).toBe(409);
    expect(parseError(tooMuch.body).details?.[0]?.path).toBe('body.amountMinor');
    expect(await balanceOf(s.user, s.cash)).toBe(0n);

    await record(s.user, expense(s, { amountMinor: '5000001' }));
    expect(await balanceOf(s.user, s.bank)).toBe(-1n);
  });

  it('checks outgoing transfers too, and refuses them atomically', async () => {
    const s = await setup();

    const response = await postTransaction(s.user, {
      type: 'transfer',
      accountId: s.cash,
      transferAccountId: s.bank,
      amountMinor: '100001',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
    });

    expect(response.status).toBe(409);
    expect(await balanceOf(s.user, s.cash)).toBe(100_000n);
    expect(await balanceOf(s.user, s.bank)).toBe(5_000_000n);
  });
});

describe('transfers', () => {
  it('moves money in one row, without counting as income or spending', async () => {
    const s = await setup();
    await record(s.user, expense(s, { accountId: s.card, amountMinor: '200000' }));

    const item = await record(s.user, {
      type: 'transfer',
      accountId: s.bank,
      transferAccountId: s.card,
      amountMinor: '500000',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
      paymentMethod: 'net_banking',
    });

    expect(item.transaction).toMatchObject({
      type: 'transfer',
      transferAccountId: s.card,
      description: 'Transfer between accounts',
    });
    expect(item.transferAccount?.name).toBe('Rewards Card');
    expect(await prisma.transaction.count({ where: { type: 'transfer' } })).toBe(1);
    expect(await balanceOf(s.user, s.bank)).toBe(4_500_000n);
    // Paying the card brings the amount owed down: 12,500 + 2,000 − 5,000 = 9,500.
    const card = await getAccount(s.user, s.card);
    expect(card.balance.amountOwedMinor).toBe('950000');

    expect(await summary(s.user)).toEqual({
      currencies: [
        {
          currency: 'INR',
          incomeMinor: '0',
          expenseMinor: '200000',
          netMinor: '-200000',
          incomeCount: 0,
          expenseCount: 1,
        },
      ],
    });
    // The transfer is listed once, for either account.
    expect((await list(s.user, `?accountId=${s.card}&type=transfer`)).items).toHaveLength(1);
    expect((await list(s.user, `?accountId=${s.bank}&type=transfer`)).items).toHaveLength(1);
  });
});

describe('balance adjustments and reconciliation', () => {
  async function preview(
    user: SignedIn,
    body: Record<string, unknown>,
  ): Promise<ReconciliationPreviewDto> {
    const response = await withCsrf(
      user.agent.post(`${TRANSACTIONS}/reconciliations/preview`),
      user,
    )
      .send(body)
      .expect(200);
    return apiSuccessResponseSchema(reconciliationPreviewDtoSchema).parse(response.body).data;
  }

  it('previews and records the exact difference, keeping the opening balance', async () => {
    const s = await setup();
    await record(s.user, expense(s, { amountMinor: '245000' }));
    const asOf = s.context.clock.now().toISOString();

    const result = await preview(s.user, {
      accountId: s.bank,
      observedBalanceMinor: '4750050',
      asOf,
    });
    expect(result.before.currentBalanceMinor).toBe('4755000');
    expect(result.after.currentBalanceMinor).toBe('4750050');
    expect(result.adjustment).toEqual({ direction: 'decrease', amountMinor: '4950' });
    expect(await prisma.transaction.count()).toBe(1);

    const response = await withCsrf(s.user.agent.post(`${TRANSACTIONS}/reconciliations`), s.user)
      .send({
        accountId: s.bank,
        observedBalanceMinor: '4750050',
        asOf,
        description: 'Matched to bank statement',
        expectedAdjustmentMinor: '-4950',
      })
      .expect(201);
    const adjustment = parseItem(response.body).transaction;
    expect(adjustment).toMatchObject({
      type: 'balance_adjustment',
      adjustmentDirection: 'decrease',
      amountMinor: '4950',
      description: 'Matched to bank statement',
    });
    const account = await getAccount(s.user, s.bank);
    expect(account.balance.currentBalanceMinor).toBe('4750050');
    expect(account.account.openingBalanceMinor).toBe('5000000');
    // Never income or spending.
    expect((await summary(s.user)).currencies[0]?.expenseMinor).toBe('245000');
  });

  it('speaks in amounts owed for credit cards: a lower signed balance means more owed', async () => {
    const s = await setup();
    const asOf = s.context.clock.now().toISOString();

    // The statement says ₹13,000 is owed; CalmCash says ₹12,500.
    const result = await preview(s.user, {
      accountId: s.card,
      observedBalanceMinor: '-1300000',
      asOf,
    });

    expect(result.before.amountOwedMinor).toBe('1250000');
    expect(result.after.amountOwedMinor).toBe('1300000');
    expect(result.after.availableCreditMinor).toBe('8700000');
    expect(result.adjustment).toEqual({ direction: 'decrease', amountMinor: '50000' });
  });

  it('refuses a correction that no longer matches what was confirmed, or that changes nothing', async () => {
    const s = await setup();
    const asOf = s.context.clock.now().toISOString();
    const body = {
      accountId: s.bank,
      observedBalanceMinor: '4900000',
      asOf,
      description: 'Statement',
      expectedAdjustmentMinor: '-100000',
    };
    // Something else is recorded between the preview and the confirmation.
    await record(s.user, expense(s, { amountMinor: '50000' }));

    const stale = await withCsrf(s.user.agent.post(`${TRANSACTIONS}/reconciliations`), s.user)
      .send(body)
      .expect(409);
    expect(parseError(stale.body).message).toContain('changed while you were reviewing');

    const unchanged = await preview(s.user, {
      accountId: s.bank,
      observedBalanceMinor: '4950000',
      asOf,
    });
    expect(unchanged.adjustment).toBeUndefined();
    await withCsrf(s.user.agent.post(`${TRANSACTIONS}/reconciliations`), s.user)
      .send({ ...body, observedBalanceMinor: '4950000', expectedAdjustmentMinor: '1' })
      .expect(409);
    expect(await prisma.transaction.count({ where: { type: 'balance_adjustment' } })).toBe(0);
  });

  it('records a repeated confirmation only once', async () => {
    const s = await setup();
    const key = randomUUID();
    const body = {
      accountId: s.cash,
      observedBalanceMinor: '90000',
      asOf: s.context.clock.now().toISOString(),
      description: 'Counted the cash',
      expectedAdjustmentMinor: '-10000',
    };
    const send = (): request.Test =>
      withCsrf(s.user.agent.post(`${TRANSACTIONS}/reconciliations`), s.user)
        .set('Idempotency-Key', key)
        .send(body);

    const first = await send().expect(201);
    const again = await send().expect(200);

    expect(parseItem(again.body).transaction.id).toBe(parseItem(first.body).transaction.id);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balanceOf(s.user, s.cash)).toBe(90_000n);
  });

  it('refuses a negative observed balance for cash and a date before tracking began', async () => {
    const s = await setup();
    const now = s.context.clock.now().toISOString();

    for (const [body, path] of [
      [{ accountId: s.cash, observedBalanceMinor: '-1', asOf: now }, 'body.observedBalanceMinor'],
      [
        { accountId: s.bank, observedBalanceMinor: '1', asOf: '2024-06-01T00:00:00.000Z' },
        'body.asOf',
      ],
    ] as const) {
      const response = await withCsrf(
        s.user.agent.post(`${TRANSACTIONS}/reconciliations/preview`),
        s.user,
      )
        .send(body)
        .expect(400);
      expect(parseError(response.body).details?.[0]?.path).toBe(path);
    }
  });

  it('also accepts a direct adjustment with an explicit direction', async () => {
    const s = await setup();

    const item = await record(s.user, {
      type: 'balance_adjustment',
      accountId: s.card,
      adjustmentDirection: 'increase',
      amountMinor: '250000',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
      description: 'Cashback credited',
    });

    expect(item.transaction).toMatchObject({ adjustmentDirection: 'increase' });
    expect((await getAccount(s.user, s.card)).balance.amountOwedMinor).toBe('1000000');
    expect(await summary(s.user)).toEqual({ currencies: [] });
  });
});

describe('idempotent creation', () => {
  it('returns the first transaction for a retried request instead of recording it twice', async () => {
    const s = await setup();
    const key = randomUUID();

    const first = await postTransaction(s.user, expense(s), key).expect(201);
    const retry = await postTransaction(s.user, expense(s), key).expect(200);

    expect(parseItem(retry.body).transaction.id).toBe(parseItem(first.body).transaction.id);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await balanceOf(s.user, s.bank)).toBe(4_755_000n);
  });

  it('refuses to reuse a key for a different transaction', async () => {
    const s = await setup();
    const key = randomUUID();
    await postTransaction(s.user, expense(s), key).expect(201);

    const response = await postTransaction(s.user, expense(s, { amountMinor: '1' }), key).expect(
      409,
    );

    expect(parseError(response.body).code).toBe('CONFLICT');
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('records one transaction when identical requests race', async () => {
    const s = await setup();
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postTransaction(s.user, expense(s), key)),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(responses.map((response) => parseItem(response.body).transaction.id)).size).toBe(
      1,
    );
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('keeps keys per user and rejects malformed keys', async () => {
    const s = await setup();
    const other = await newUser(s.context);
    const otherBank = (await createAccount(other, BANK)).account.id;
    const key = randomUUID();

    await postTransaction(s.user, expense(s), key).expect(201);
    await postTransaction(
      other,
      expense(s, {
        accountId: otherBank,
        categoryId: await categoryId(other, 'expense', 'Groceries'),
      }),
      key,
    ).expect(201);
    await postTransaction(s.user, expense(s), 'not-a-uuid').expect(400);
    expect(await prisma.transaction.count()).toBe(2);
  });
});

describe('editing', () => {
  it('replaces the old effect with the new one on every affected account', async () => {
    const s = await setup();
    const { transaction } = await record(s.user, expense(s, { amountMinor: '10000' }));
    const url = `${TRANSACTIONS}/${transaction.id}`;

    await withCsrf(s.user.agent.patch(url), s.user)
      .send({ amountMinor: '30000', accountId: s.card, merchant: 'Big Bazaar', notes: 'Corrected' })
      .expect(200);

    expect(await balanceOf(s.user, s.bank)).toBe(5_000_000n);
    expect(await balanceOf(s.user, s.card)).toBe(-1_280_000n);
    const updated = parseItem((await s.user.agent.get(url).expect(200)).body).transaction;
    expect(updated).toMatchObject({
      amountMinor: '30000',
      accountId: s.card,
      merchant: 'Big Bazaar',
      notes: 'Corrected',
    });
  });

  it('changes the type only when the result is complete and consistent', async () => {
    const s = await setup();
    const { transaction } = await record(s.user, expense(s, { amountMinor: '20000' }));
    const url = `${TRANSACTIONS}/${transaction.id}`;

    const incomplete = await withCsrf(s.user.agent.patch(url), s.user)
      .send({ type: 'transfer', transferAccountId: s.cash })
      .expect(400);
    expect(
      parseError(incomplete.body)
        .details?.map((detail) => detail.path)
        .sort(),
    ).toEqual(['body.categoryId', 'body.merchant']);
    expect(await balanceOf(s.user, s.bank)).toBe(4_980_000n);

    const response = await withCsrf(s.user.agent.patch(url), s.user)
      .send({ type: 'transfer', transferAccountId: s.cash, merchant: null, categoryId: null })
      .expect(200);

    expect(parseItem(response.body).transaction).toMatchObject({
      type: 'transfer',
      transferAccountId: s.cash,
      paymentMethod: 'upi',
    });
    expect(parseItem(response.body).category).toBeUndefined();
    expect(await balanceOf(s.user, s.bank)).toBe(4_980_000n);
    expect(await balanceOf(s.user, s.cash)).toBe(120_000n);
    expect((await summary(s.user)).currencies).toEqual([]);
  });

  it('refuses an edit that would take cash below zero, leaving everything unchanged', async () => {
    const s = await setup();
    const { transaction } = await record(
      s.user,
      expense(s, { accountId: s.cash, amountMinor: '50000' }),
    );

    await withCsrf(s.user.agent.patch(`${TRANSACTIONS}/${transaction.id}`), s.user)
      .send({ amountMinor: '150000' })
      .expect(409);

    expect(await balanceOf(s.user, s.cash)).toBe(50_000n);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row.amountMinor).toBe(50_000n);
  });

  it('keeps history on archived accounts read-only', async () => {
    const s = await setup();
    const { transaction } = await record(
      s.user,
      expense(s, { accountId: s.cash, amountMinor: '100' }),
    );
    await withCsrf(s.user.agent.post(`${ACCOUNTS}/${s.cash}/archive`), s.user).expect(200);

    const url = `${TRANSACTIONS}/${transaction.id}`;
    const attempts = [
      () => withCsrf(s.user.agent.patch(url), s.user).send({ notes: 'x' }),
      () => withCsrf(s.user.agent.patch(url), s.user).send({ accountId: s.bank }),
      () => withCsrf(s.user.agent.post(`${url}/void`), s.user).send({}),
    ];
    for (const attempt of attempts) {
      expect((await attempt()).status).toBe(409);
    }
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row).toMatchObject({ accountId: s.cash, voidedAt: null, notes: null });
  });

  it('rejects malformed updates instead of discarding fields', async () => {
    const s = await setup();
    const { transaction } = await record(s.user, expense(s));
    const url = `${TRANSACTIONS}/${transaction.id}`;

    for (const body of [
      {},
      { userId: s.user.session.user.id },
      { description: null },
      { adjustmentDirection: 'increase' },
      { categoryId: s.salary },
    ]) {
      expect(
        (await withCsrf(s.user.agent.patch(url), s.user).send(body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });
});

describe('voiding', () => {
  it('voids and restores reversibly, never applying the effect twice', async () => {
    const s = await setup();
    const { transaction } = await record(s.user, expense(s, { amountMinor: '100000' }));
    const url = `${TRANSACTIONS}/${transaction.id}`;

    const voided = await withCsrf(s.user.agent.post(`${url}/void`), s.user)
      .send({ reason: 'Recorded twice' })
      .expect(200);
    await withCsrf(s.user.agent.post(`${url}/void`), s.user).expect(200);

    expect(parseItem(voided.body).transaction).toMatchObject({
      status: 'voided',
      voidReason: 'Recorded twice',
    });
    expect(await balanceOf(s.user, s.bank)).toBe(5_000_000n);
    expect((await list(s.user)).items).toHaveLength(0);
    expect((await list(s.user, '?status=voided')).items).toHaveLength(1);
    expect((await summary(s.user)).currencies).toEqual([]);
    expect(await prisma.transaction.count()).toBe(1);

    await withCsrf(s.user.agent.patch(url), s.user).send({ notes: 'x' }).expect(409);

    await withCsrf(s.user.agent.post(`${url}/restore`), s.user).expect(200);
    await withCsrf(s.user.agent.post(`${url}/restore`), s.user).expect(200);
    expect(await balanceOf(s.user, s.bank)).toBe(4_900_000n);
  });

  it('voids a transfer as one record, restoring both accounts', async () => {
    const s = await setup();
    const { transaction } = await record(s.user, {
      type: 'transfer',
      accountId: s.bank,
      transferAccountId: s.cash,
      amountMinor: '20000',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
    });

    await withCsrf(s.user.agent.post(`${TRANSACTIONS}/${transaction.id}/void`), s.user).expect(200);

    expect(await balanceOf(s.user, s.bank)).toBe(5_000_000n);
    expect(await balanceOf(s.user, s.cash)).toBe(100_000n);
  });

  it('refuses to void income that cash has already been spent from', async () => {
    const s = await setup();
    const income = await record(s.user, {
      type: 'income',
      accountId: s.cash,
      amountMinor: '50000',
      occurredAt: hoursAgo(s.context.clock.now(), 2),
      description: 'Gift',
      categoryId: s.salary,
    });
    await record(s.user, expense(s, { accountId: s.cash, amountMinor: '120000' }));

    await withCsrf(
      s.user.agent.post(`${TRANSACTIONS}/${income.transaction.id}/void`),
      s.user,
    ).expect(409);

    expect(await balanceOf(s.user, s.cash)).toBe(30_000n);
  });
});

describe('listing, searching, and filtering', () => {
  async function seed(s: Setup): Promise<void> {
    const now = s.context.clock.now();
    await record(
      s.user,
      expense(s, { occurredAt: hoursAgo(now, 50), merchant: 'FreshMart', tags: ['family'] }),
    );
    await record(
      s.user,
      expense(s, {
        occurredAt: hoursAgo(now, 40),
        merchant: 'Pizza Place',
        description: 'Dinner, 50% off',
        categoryId: s.restaurants,
        amountMinor: '80000',
        paymentMethod: 'credit_card',
        accountId: s.card,
        tags: ['family', 'treat'],
      }),
    );
    await record(s.user, {
      type: 'income',
      accountId: s.bank,
      amountMinor: '8500000',
      occurredAt: hoursAgo(now, 30),
      description: 'Salary',
      merchant: 'Acme Corp',
      categoryId: s.salary,
      tags: ['work'],
    });
    await record(s.user, {
      type: 'transfer',
      accountId: s.bank,
      transferAccountId: s.cash,
      amountMinor: '20000',
      occurredAt: hoursAgo(now, 20),
      description: 'ATM withdrawal',
    });
  }

  it('returns the caller’s transactions newest first with typed pagination', async () => {
    const s = await setup();
    await seed(s);
    const other = await newUser(s.context);
    await record(other, {
      type: 'income',
      accountId: (await createAccount(other, BANK)).account.id,
      amountMinor: '1',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
      description: 'Not yours',
      categoryId: await categoryId(other, 'income', 'Salary'),
    });

    const page = await list(s.user, '?pageSize=3');
    expect(page.pagination).toEqual({ page: 1, pageSize: 3, totalItems: 4, totalPages: 2 });
    expect(page.items.map((item) => item.transaction.description)).toEqual([
      'ATM withdrawal',
      'Salary',
      'Dinner, 50% off',
    ]);
    const second = await list(s.user, '?pageSize=3&page=2');
    expect(second.items.map((item) => item.transaction.description)).toEqual(['Weekly groceries']);
    expect((await list(s.user, '?sort=largest')).items[0]?.transaction.description).toBe('Salary');
    expect((await list(s.user, '?page=9')).items).toEqual([]);
  });

  it('searches merchant, description, notes, category, and tags; wildcards match literally', async () => {
    const s = await setup();
    await seed(s);
    const descriptions = async (query: string): Promise<string[]> =>
      (await list(s.user, query)).items.map((item) => item.transaction.description);

    expect(await descriptions('?q=fresh')).toEqual(['Weekly groceries']);
    expect(await descriptions('?q=ACME')).toEqual(['Salary']);
    expect(await descriptions('?q=restaurants')).toEqual(['Dinner, 50% off']);
    expect(await descriptions('?q=food')).toEqual(['Dinner, 50% off']);
    expect(await descriptions('?q=work')).toEqual(['Salary']);
    expect(await descriptions(`?q=${encodeURIComponent('50%')}`)).toEqual(['Dinner, 50% off']);
    expect(await descriptions(`?q=${encodeURIComponent('%')}`)).toEqual(['Dinner, 50% off']);
    expect(await descriptions('?q=_')).toEqual([]);
  });

  it('combines type, account, category, method, tag, and amount filters', async () => {
    const s = await setup();
    await seed(s);
    const count = async (query: string): Promise<number> =>
      (await list(s.user, query)).items.length;

    expect(await count('?type=expense')).toBe(2);
    expect(await count(`?accountId=${s.cash}`)).toBe(1);
    expect(await count(`?categoryId=${s.food}`)).toBe(1);
    expect(await count(`?categoryId=${s.restaurants}`)).toBe(1);
    expect(await count('?paymentMethod=credit_card')).toBe(1);
    expect(await count('?tags=family')).toBe(2);
    expect(await count('?tags=family,treat')).toBe(1);
    expect(await count('?minAmount=800&maxAmount=2450')).toBe(2);
    expect(await count('?minAmount=800.01')).toBe(2);
    expect(await count('?type=expense&tags=family&paymentMethod=upi')).toBe(1);
    expect(await count('?type=transfer&q=atm')).toBe(1);
  });

  it('interprets calendar-date filters in the user’s time zone', async () => {
    const s = await setup();
    const at = (iso: string): Record<string, unknown> =>
      expense(s, { occurredAt: iso, amountMinor: '100' });
    // 23:30 on 1 Mar in Kolkata is still 1 Mar there, although it is 18:00 UTC.
    await record(s.user, at('2026-03-01T18:00:00.000Z'));
    // 00:30 on 2 Mar in Kolkata.
    await record(s.user, at('2026-03-01T19:00:00.000Z'));

    expect((await list(s.user, '?from=2026-03-01&to=2026-03-01')).items).toHaveLength(1);
    expect((await list(s.user, '?from=2026-03-02&to=2026-03-02')).items).toHaveLength(1);
    expect((await summary(s.user, '?from=2026-03-02')).currencies[0]?.expenseCount).toBe(1);
  });

  it('rejects unsafe or invalid queries', async () => {
    const s = await setup();
    for (const query of [
      '?sort=amount_minor',
      '?pageSize=1000',
      '?from=2026-10-31&to=2026-10-01',
      '?type=refund',
      '?accountId=not-a-uuid',
      '?unknown=1',
    ]) {
      expect((await s.user.agent.get(`${TRANSACTIONS}${query}`)).status, query).toBe(400);
    }
  });
});

describe('cash-flow summary', () => {
  it('totals income and spending per currency and never mixes currencies', async () => {
    const s = await setup();
    const usdBank = (
      await createAccount(s.user, {
        ...BANK,
        name: 'US',
        currency: 'USD',
        openingBalanceMinor: '0',
      })
    ).account.id;
    await record(s.user, expense(s, { amountMinor: '245000' }));
    await record(s.user, expense(s, { amountMinor: '5000', accountId: s.cash }));
    await record(s.user, {
      type: 'income',
      accountId: usdBank,
      amountMinor: '150000',
      occurredAt: hoursAgo(s.context.clock.now(), 1),
      description: 'Contract',
      categoryId: await categoryId(s.user, 'income', 'Freelance'),
    });

    expect(await summary(s.user)).toEqual({
      currencies: [
        {
          currency: 'INR',
          incomeMinor: '0',
          expenseMinor: '250000',
          netMinor: '-250000',
          incomeCount: 0,
          expenseCount: 2,
        },
        {
          currency: 'USD',
          incomeMinor: '150000',
          expenseMinor: '0',
          netMinor: '150000',
          incomeCount: 1,
          expenseCount: 0,
        },
      ],
    });
    expect((await summary(s.user, `?accountId=${s.cash}`)).currencies[0]?.expenseMinor).toBe(
      '5000',
    );
  });
});

describe('ownership and request security', () => {
  it('never reveals or changes another user’s transaction', async () => {
    const s = await setup();
    const { transaction } = await record(s.user, expense(s));
    const mallory = await newUser(s.context);
    const unknown = randomUUID();

    const attempts = [
      (id: string) => mallory.agent.get(`${TRANSACTIONS}/${id}`),
      (id: string) =>
        withCsrf(mallory.agent.patch(`${TRANSACTIONS}/${id}`), mallory).send({ notes: 'x' }),
      (id: string) => withCsrf(mallory.agent.post(`${TRANSACTIONS}/${id}/void`), mallory).send({}),
      (id: string) => withCsrf(mallory.agent.post(`${TRANSACTIONS}/${id}/restore`), mallory),
    ];
    for (const attempt of attempts) {
      const foreign = await attempt(transaction.id).expect(404);
      const missing = await attempt(unknown).expect(404);
      expect(parseError(foreign.body).message).toBe(parseError(missing.body).message);
    }
    expect((await list(mallory)).items).toEqual([]);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(row).toMatchObject({ voidedAt: null, notes: null });
  });

  it('requires a session and a valid CSRF token', async () => {
    const s = await setup();

    await request(s.context.app).get(TRANSACTIONS).expect(401);
    await fromApp(request(s.context.app).post(TRANSACTIONS)).send(expense(s)).expect(401);
    const missing = await fromApp(s.user.agent.post(TRANSACTIONS)).send(expense(s)).expect(403);
    expect(parseError(missing.body).code).toBe('CSRF_TOKEN_INVALID');
    await fromApp(s.user.agent.post(TRANSACTIONS))
      .set('x-csrf-token', 'x'.repeat(43))
      .send(expense(s))
      .expect(403);
    expect(await prisma.transaction.count()).toBe(0);
    const response = await s.user.agent.get(TRANSACTIONS).expect(200);
    expect(response.get('Cache-Control')).toBe('no-store');
  });
});

describe('bulk operations', () => {
  async function bulk(s: Setup, body: Record<string, unknown>): Promise<request.Response> {
    return withCsrf(s.user.agent.post(`${TRANSACTIONS}/bulk`), s.user).send(body);
  }

  it('categorises, tags, untags, and voids several transactions at once', async () => {
    const s = await setup();
    const ids = [
      (await record(s.user, expense(s, { amountMinor: '100' }))).transaction.id,
      (await record(s.user, expense(s, { amountMinor: '200', tags: [] }))).transaction.id,
    ];

    const categorised = await bulk(s, {
      action: 'set_category',
      transactionIds: ids,
      categoryId: s.restaurants,
    });
    expect(
      apiSuccessResponseSchema(bulkTransactionResultDtoSchema).parse(categorised.body).data,
    ).toEqual({
      action: 'set_category',
      requested: 2,
      changed: 2,
    });
    const tagged = await bulk(s, {
      action: 'add_tags',
      transactionIds: ids,
      tags: ['Reimbursable'],
    });
    expect(tagged.status).toBe(200);
    expect((await list(s.user, '?tags=reimbursable')).items).toHaveLength(2);
    await bulk(s, { action: 'remove_tags', transactionIds: ids, tags: ['family'] }).then(
      (response) => {
        expect(response.status).toBe(200);
      },
    );
    expect((await list(s.user, '?tags=family')).items).toHaveLength(0);

    const voided = await bulk(s, { action: 'void', transactionIds: ids, reason: 'Duplicates' });
    expect(voided.body).toMatchObject({ data: { action: 'void', requested: 2, changed: 2 } });
    expect(await balanceOf(s.user, s.bank)).toBe(5_000_000n);
    const again = await bulk(s, { action: 'void', transactionIds: ids });
    expect(again.body).toMatchObject({ data: { changed: 0 } });
  });

  it('changes nothing when any selected transaction is foreign, missing, or incompatible', async () => {
    const s = await setup();
    const mine = (await record(s.user, expense(s))).transaction.id;
    const transfer = (
      await record(s.user, {
        type: 'transfer',
        accountId: s.bank,
        transferAccountId: s.cash,
        amountMinor: '100',
        occurredAt: hoursAgo(s.context.clock.now(), 1),
      })
    ).transaction.id;
    const mallory = await newUser(s.context);
    const theirs = (
      await record(mallory, {
        type: 'income',
        accountId: (await createAccount(mallory, BANK)).account.id,
        amountMinor: '1',
        occurredAt: hoursAgo(s.context.clock.now(), 1),
        description: 'Theirs',
        categoryId: await categoryId(mallory, 'income', 'Salary'),
      })
    ).transaction.id;

    const foreign = await bulk(s, { action: 'void', transactionIds: [mine, theirs] });
    expect(foreign.status).toBe(404);
    expect(parseError(foreign.body).details).toEqual([
      { path: 'body.transactionIds.1', message: 'Not found.' },
    ]);

    const incompatible = await bulk(s, {
      action: 'set_category',
      transactionIds: [mine, transfer],
      categoryId: s.restaurants,
    });
    expect(incompatible.status).toBe(400);
    expect(parseError(incompatible.body).details?.[0]?.path).toBe('body.transactionIds.1');

    const rows = await prisma.transaction.findMany({ where: { id: { in: [mine, theirs] } } });
    expect(rows.every((row) => row.voidedAt === null)).toBe(true);
    expect(rows.find((row) => row.id === mine)?.categoryId).toBe(s.groceries);
  });

  it('enforces the documented batch size', async () => {
    const s = await setup();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    expect((await bulk(s, { action: 'void', transactionIds: ids })).status).toBe(400);
  });
});

describe('accounts after transactions', () => {
  it('locks the opening balance once the API records a transaction, and keeps type rules honest', async () => {
    const s = await setup();
    const savings = (
      await createAccount(s.user, {
        ...BANK,
        name: 'Spare',
        type: 'bank',
        openingBalanceMinor: '100',
      })
    ).account.id;
    await record(s.user, expense(s, { accountId: savings, amountMinor: '500' }));

    const account = await getAccount(s.user, savings);
    expect(account.hasTransactions).toBe(true);
    expect(account.balance.currentBalanceMinor).toBe('-400');
    await withCsrf(s.user.agent.patch(`${ACCOUNTS}/${savings}`), s.user)
      .send({ openingBalanceMinor: '1000' })
      .expect(409);
    // Overdrawn by transactions, so it cannot become a savings account (never negative).
    const response = await withCsrf(s.user.agent.patch(`${ACCOUNTS}/${savings}`), s.user)
      .send({ type: 'savings' })
      .expect(400);
    expect(parseError(response.body).details?.[0]?.path).toBe('body.type');
  });
});
