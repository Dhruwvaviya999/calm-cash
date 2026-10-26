import {
  accountListDtoSchema,
  accountSummaryDtoSchema,
  accountWithBalanceDtoSchema,
  API_V1_PREFIX,
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  type AccountWithBalanceDto,
  type TransactionType,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  createVerifiedUser,
  fromApp,
  signIn,
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';
import { todayIn } from './accounts.service';

const ACCOUNTS = `${API_V1_PREFIX}/accounts`;
const { prisma, createContext } = useIntegrationDatabase();

const accountEnvelope = apiSuccessResponseSchema(accountWithBalanceDtoSchema);

async function newUser(context: TestContext): Promise<SignedIn> {
  return signIn(context, await createVerifiedUser(context));
}

async function createAccount(
  user: SignedIn,
  body: Record<string, unknown>,
): Promise<AccountWithBalanceDto> {
  const response = await withCsrf(user.agent.post(ACCOUNTS), user).send(body).expect(201);
  return accountEnvelope.parse(response.body).data;
}

async function getAccount(user: SignedIn, accountId: string): Promise<AccountWithBalanceDto> {
  const response = await user.agent.get(`${ACCOUNTS}/${accountId}`).expect(200);
  return accountEnvelope.parse(response.body).data;
}

async function record(
  user: SignedIn,
  type: TransactionType,
  accountId: string,
  amountMinor: bigint,
  options: {
    transferAccountId?: string;
    currency?: string;
    occurredAt?: Date;
    userId?: string;
  } = {},
): Promise<void> {
  // Phase 5 adds transaction endpoints; until then tests write rows directly.
  await prisma.transaction.create({
    data: {
      userId: options.userId ?? user.session.user.id,
      accountId,
      type,
      amountMinor,
      currency: options.currency ?? 'INR',
      description: `${type} for balance tests`,
      transferAccountId: options.transferAccountId ?? null,
      occurredAt: options.occurredAt ?? new Date(),
    },
  });
}

const BANK = {
  name: 'HDFC Salary',
  type: 'bank',
  currency: 'INR',
  openingBalanceMinor: '5000000',
  institution: 'HDFC Bank',
} as const;

const CARD = {
  name: 'Rewards Card',
  type: 'credit_card',
  currency: 'INR',
  openingBalanceMinor: '-1250000',
  creditLimitMinor: '10000000',
} as const;

describe('POST /accounts', () => {
  it('creates an account owned by the signed-in user, defaulting the opening date to today', async () => {
    const context = createContext();
    const user = await newUser(context);

    const created = await createAccount(user, { ...BANK, color: 'blue' });

    expect(created.account).toMatchObject({
      userId: user.session.user.id,
      name: 'HDFC Salary',
      type: 'bank',
      classification: 'asset',
      currency: 'INR',
      openingBalanceMinor: '5000000',
      openingBalanceDate: todayIn('Asia/Kolkata', context.clock.now()),
      institution: 'HDFC Bank',
      color: 'blue',
      status: 'active',
    });
    expect(created.balance).toEqual({ currentBalanceMinor: '5000000', countedTransactions: 0 });
    expect(created.hasTransactions).toBe(false);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: created.account.id } });
    expect(row.userId).toBe(user.session.user.id);
    expect(row.openingBalanceMinor).toBe(5_000_000n);
  });

  it('rejects owner IDs and other privileged fields instead of ignoring them', async () => {
    const context = createContext();
    const user = await newUser(context);
    const other = await newUser(context);

    for (const extra of [
      { userId: other.session.user.id },
      { id: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70' },
      { archivedAt: new Date().toISOString() },
      { status: 'archived' },
    ]) {
      await withCsrf(user.agent.post(ACCOUNTS), user)
        .send({ ...BANK, ...extra })
        .expect(400);
    }
    expect(await prisma.account.count()).toBe(0);
  });

  it('rejects invalid input with field details', async () => {
    const context = createContext();
    const user = await newUser(context);

    const cases: [Record<string, unknown>, string][] = [
      [{ ...BANK, type: 'crypto' }, 'body.type'],
      [{ ...BANK, type: 'loan' }, 'body.type'],
      [{ ...BANK, currency: 'XYZ' }, 'body.currency'],
      [{ ...BANK, openingBalanceMinor: undefined }, 'body.openingBalanceMinor'],
      [{ ...BANK, openingBalanceMinor: '50000.00' }, 'body.openingBalanceMinor'],
      [{ ...BANK, type: 'cash', openingBalanceMinor: '-100' }, 'body.openingBalanceMinor'],
      [{ ...BANK, creditLimitMinor: '100000' }, 'body.creditLimitMinor'],
      [{ ...CARD, creditLimitMinor: '-5' }, 'body.creditLimitMinor'],
      [{ ...BANK, name: '   ' }, 'body.name'],
      [{ ...BANK, openingBalanceDate: '2999-01-01' }, 'body.openingBalanceDate'],
    ];
    for (const [body, path] of cases) {
      const response = await withCsrf(user.agent.post(ACCOUNTS), user).send(body).expect(400);
      const error = apiErrorResponseSchema.parse(response.body).error;
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details?.map((detail) => detail.path)).toContain(path);
    }
    expect(await prisma.account.count()).toBe(0);
  });

  it('keeps large amounts exact through the database round trip', async () => {
    const context = createContext();
    const user = await newUser(context);

    const card = await createAccount(user, {
      ...CARD,
      openingBalanceMinor: '-999999999999999',
      creditLimitMinor: '999999999999999',
    });

    const reloaded = await getAccount(user, card.account.id);
    expect(reloaded.account.openingBalanceMinor).toBe('-999999999999999');
    expect(reloaded.account.creditLimitMinor).toBe('999999999999999');
    expect(reloaded.balance.amountOwedMinor).toBe('999999999999999');
    expect(reloaded.balance.availableCreditMinor).toBe('0');
    const row = await prisma.account.findUniqueOrThrow({ where: { id: card.account.id } });
    expect(row.openingBalanceMinor).toBe(-999_999_999_999_999n);
  });

  it('allows duplicate names', async () => {
    const context = createContext();
    const user = await newUser(context);

    await createAccount(user, { ...BANK, name: 'Cash', type: 'cash', openingBalanceMinor: '0' });
    await createAccount(user, { ...BANK, name: 'Cash', type: 'cash', openingBalanceMinor: '0' });

    expect(await prisma.account.count({ where: { name: 'Cash' } })).toBe(2);
  });

  it('requires a session and the CSRF token', async () => {
    const context = createContext();
    const user = await newUser(context);

    await fromApp(request(context.app).post(ACCOUNTS)).send(BANK).expect(401);
    const response = await fromApp(user.agent.post(ACCOUNTS)).send(BANK).expect(403);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('CSRF_TOKEN_INVALID');
    await request(context.app).get(ACCOUNTS).expect(401);
  });
});

describe('GET /accounts', () => {
  it('returns an empty list for a new user', async () => {
    const context = createContext();
    const user = await newUser(context);

    const response = await user.agent.get(ACCOUNTS).expect(200);

    expect(apiSuccessResponseSchema(accountListDtoSchema).parse(response.body).data).toEqual({
      accounts: [],
    });
    expect(response.get('Cache-Control')).toBe('no-store');
  });

  it('lists only the caller’s accounts in creation order, with status and type filters', async () => {
    const context = createContext();
    const alice = await newUser(context);
    const bob = await newUser(context);
    const bank = await createAccount(alice, BANK);
    context.clock.advance(1000);
    const card = await createAccount(alice, CARD);
    context.clock.advance(1000);
    const wallet = await createAccount(alice, {
      name: 'UPI Wallet',
      type: 'digital_wallet',
      currency: 'INR',
      openingBalanceMinor: '0',
    });
    await createAccount(bob, BANK);
    await withCsrf(alice.agent.post(`${ACCOUNTS}/${bank.account.id}/archive`), alice).expect(200);

    const list = async (query: string): Promise<string[]> => {
      const response = await alice.agent.get(`${ACCOUNTS}${query}`).expect(200);
      return apiSuccessResponseSchema(accountListDtoSchema)
        .parse(response.body)
        .data.accounts.map((entry) => entry.account.id);
    };

    expect(await list('')).toEqual([card.account.id, wallet.account.id]);
    expect(await list('?status=archived')).toEqual([bank.account.id]);
    expect(await list('?status=all')).toEqual([
      card.account.id,
      wallet.account.id,
      bank.account.id,
    ]);
    expect(await list('?type=credit_card')).toEqual([card.account.id]);
    await alice.agent.get(`${ACCOUNTS}?status=deleted`).expect(400);
  });
});

describe('ownership', () => {
  it('never lets one user read, change, archive, or restore another user’s account', async () => {
    const context = createContext();
    const alice = await newUser(context);
    const mallory = await newUser(context);
    const target = await createAccount(alice, BANK);
    const id = target.account.id;
    const unknown = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70';

    const attempts = [
      (agent: SignedIn, accountId: string) => agent.agent.get(`${ACCOUNTS}/${accountId}`),
      (agent: SignedIn, accountId: string) =>
        withCsrf(agent.agent.patch(`${ACCOUNTS}/${accountId}`), agent).send({ name: 'Mine now' }),
      (agent: SignedIn, accountId: string) =>
        withCsrf(agent.agent.post(`${ACCOUNTS}/${accountId}/archive`), agent),
      (agent: SignedIn, accountId: string) =>
        withCsrf(agent.agent.post(`${ACCOUNTS}/${accountId}/restore`), agent),
    ];
    for (const attempt of attempts) {
      const foreign = await attempt(mallory, id).expect(404);
      const missing = await attempt(mallory, unknown).expect(404);
      // Same answer for "someone else's" and "does not exist".
      expect(apiErrorResponseSchema.parse(foreign.body).error.message).toBe(
        apiErrorResponseSchema.parse(missing.body).error.message,
      );
    }

    const row = await prisma.account.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      name: 'HDFC Salary',
      archivedAt: null,
      userId: alice.session.user.id,
    });
    await mallory.agent.get(`${ACCOUNTS}/not-a-uuid`).expect(400);
  });
});

describe('PATCH /accounts/:id', () => {
  it('persists changes and clears optional fields with null', async () => {
    const context = createContext();
    const user = await newUser(context);
    const created = await createAccount(user, { ...BANK, color: 'blue' });

    const response = await withCsrf(user.agent.patch(`${ACCOUNTS}/${created.account.id}`), user)
      .send({ name: 'Everyday', institution: null, color: null, type: 'savings' })
      .expect(200);

    const updated = accountEnvelope.parse(response.body).data.account;
    expect(updated).toMatchObject({ name: 'Everyday', type: 'savings' });
    expect(updated).not.toHaveProperty('institution');
    expect(updated).not.toHaveProperty('color');
    expect((await getAccount(user, created.account.id)).account.name).toBe('Everyday');
  });

  it('refuses to turn money held into money owed, and checks type rules on the merged result', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, { ...BANK, openingBalanceMinor: '-50000' }); // overdraft

    const toCard = await withCsrf(user.agent.patch(`${ACCOUNTS}/${bank.account.id}`), user)
      .send({ type: 'credit_card' })
      .expect(400);
    expect(apiErrorResponseSchema.parse(toCard.body).error.details?.[0]?.path).toBe('body.type');

    const toCash = await withCsrf(user.agent.patch(`${ACCOUNTS}/${bank.account.id}`), user)
      .send({ type: 'cash' })
      .expect(400);
    expect(apiErrorResponseSchema.parse(toCash.body).error.details?.[0]?.path).toBe(
      'body.openingBalanceMinor',
    );

    await withCsrf(user.agent.patch(`${ACCOUNTS}/${bank.account.id}`), user)
      .send({ creditLimitMinor: '100000' })
      .expect(400);
    await withCsrf(user.agent.patch(`${ACCOUNTS}/${bank.account.id}`), user)
      .send({ userId: user.session.user.id })
      .expect(400);
  });

  it('corrects the opening balance freely until a transaction uses the account', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, BANK);
    const url = `${ACCOUNTS}/${bank.account.id}`;

    const corrected = await withCsrf(user.agent.patch(url), user)
      .send({ openingBalanceMinor: '5200000', openingBalanceDate: '2026-01-01' })
      .expect(200);
    expect(accountEnvelope.parse(corrected.body).data.balance.currentBalanceMinor).toBe('5200000');

    await record(user, 'expense', bank.account.id, 10_000n);

    for (const change of [
      { openingBalanceMinor: '1' },
      { openingBalanceDate: '2026-02-01' },
      { currency: 'USD', openingBalanceMinor: '100' },
    ]) {
      const response = await withCsrf(user.agent.patch(url), user).send(change).expect(409);
      expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('CONFLICT');
    }
    // Non-financial details stay editable, and an unchanged value is not a change.
    await withCsrf(user.agent.patch(url), user)
      .send({ name: 'Salary account', openingBalanceMinor: '5200000' })
      .expect(200);
    const reloaded = await getAccount(user, bank.account.id);
    expect(reloaded.hasTransactions).toBe(true);
    expect(reloaded.account.openingBalanceMinor).toBe('5200000');
  });

  it('requires amounts to be restated when the currency changes', async () => {
    const context = createContext();
    const user = await newUser(context);
    const card = await createAccount(user, CARD);
    const url = `${ACCOUNTS}/${card.account.id}`;

    const response = await withCsrf(user.agent.patch(url), user)
      .send({ currency: 'USD' })
      .expect(400);
    expect(apiErrorResponseSchema.parse(response.body).error.details?.map((d) => d.path)).toEqual([
      'body.openingBalanceMinor',
      'body.creditLimitMinor',
    ]);

    const moved = await withCsrf(user.agent.patch(url), user)
      .send({ currency: 'USD', openingBalanceMinor: '-15000', creditLimitMinor: '120000' })
      .expect(200);
    expect(accountEnvelope.parse(moved.body).data.account).toMatchObject({
      currency: 'USD',
      openingBalanceMinor: '-15000',
      creditLimitMinor: '120000',
    });
  });
});

describe('archive and restore', () => {
  it('archives and restores idempotently, keeping history and blocking edits while archived', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, BANK);
    const id = bank.account.id;
    await record(user, 'income', id, 100_000n);

    const first = await withCsrf(user.agent.post(`${ACCOUNTS}/${id}/archive`), user).expect(200);
    context.clock.advance(60_000);
    const second = await withCsrf(user.agent.post(`${ACCOUNTS}/${id}/archive`), user).expect(200);
    const archived = accountEnvelope.parse(first.body).data;
    expect(archived.account.status).toBe('archived');
    expect(accountEnvelope.parse(second.body).data.account.archivedAt).toBe(
      archived.account.archivedAt,
    );
    // History and balance survive archiving.
    expect(archived.balance.currentBalanceMinor).toBe('5100000');
    expect(await prisma.transaction.count({ where: { accountId: id } })).toBe(1);

    const blocked = await withCsrf(user.agent.patch(`${ACCOUNTS}/${id}`), user)
      .send({ name: 'Renamed' })
      .expect(409);
    expect(apiErrorResponseSchema.parse(blocked.body).error.message).toContain('Restore');

    await withCsrf(user.agent.post(`${ACCOUNTS}/${id}/restore`), user).expect(200);
    const restored = await withCsrf(user.agent.post(`${ACCOUNTS}/${id}/restore`), user).expect(200);
    expect(accountEnvelope.parse(restored.body).data.account).toMatchObject({ status: 'active' });
    expect(accountEnvelope.parse(restored.body).data.account).not.toHaveProperty('archivedAt');
  });
});

describe('balances', () => {
  it('starts from the opening balance and applies only eligible movements', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, { ...BANK, openingBalanceDate: '2026-10-01' });
    const id = bank.account.id;

    await record(user, 'income', id, 2_000_000n, { occurredAt: new Date('2026-10-05T04:00:00Z') });
    await record(user, 'expense', id, 450_000n, { occurredAt: new Date('2026-10-06T04:00:00Z') });
    // 30 Sep 18:00 UTC is 30 Sep 23:30 in Asia/Kolkata: before the opening date, not counted.
    await record(user, 'expense', id, 99_000n, { occurredAt: new Date('2026-09-30T18:00:00Z') });
    // Different currency: not part of this account's balance.
    await record(user, 'income', id, 77_000n, { currency: 'USD' });

    const reloaded = await getAccount(user, id);
    expect(reloaded.balance).toEqual({ currentBalanceMinor: '6550000', countedTransactions: 2 });
  });

  it('counts the start of the opening date in the user’s time zone', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, { ...BANK, openingBalanceDate: '2026-10-01' });

    // 30 Sep 18:30 UTC is exactly 1 Oct 00:00 in Asia/Kolkata: counted. One ms earlier: not.
    await record(user, 'income', bank.account.id, 1_000n, {
      occurredAt: new Date('2026-09-30T18:30:00.000Z'),
    });
    await record(user, 'income', bank.account.id, 7n, {
      occurredAt: new Date('2026-09-30T18:29:59.999Z'),
    });

    expect((await getAccount(user, bank.account.id)).balance.currentBalanceMinor).toBe('5001000');
  });

  it('moves transfers between accounts without creating income or spending', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, BANK);
    const card = await createAccount(user, CARD);

    await record(user, 'expense', card.account.id, 200_000n); // card purchase
    await record(user, 'transfer', bank.account.id, 500_000n, {
      transferAccountId: card.account.id,
    }); // card payment

    const bankBalance = (await getAccount(user, bank.account.id)).balance;
    const cardBalance = (await getAccount(user, card.account.id)).balance;
    expect(bankBalance).toEqual({ currentBalanceMinor: '4500000', countedTransactions: 1 });
    expect(cardBalance).toEqual({
      currentBalanceMinor: '-950000',
      amountOwedMinor: '950000',
      availableCreditMinor: '9050000',
      countedTransactions: 2,
    });

    const summary = apiSuccessResponseSchema(accountSummaryDtoSchema).parse(
      (await user.agent.get(`${ACCOUNTS}/summary`).expect(200)).body,
    ).data;
    // ₹45,000 held and ₹9,500 owed — never "₹35,500 of money".
    expect(summary).toEqual({
      currencies: [
        {
          currency: 'INR',
          assetsMinor: '4500000',
          liabilitiesMinor: '950000',
          assetAccounts: 1,
          liabilityAccounts: 1,
        },
      ],
    });
  });

  it('keeps currencies apart and leaves archived accounts out of the summary', async () => {
    const context = createContext();
    const user = await newUser(context);
    await createAccount(user, BANK);
    await createAccount(user, {
      ...BANK,
      name: 'US account',
      currency: 'USD',
      openingBalanceMinor: '25000',
    });
    const old = await createAccount(user, { ...BANK, name: 'Old', openingBalanceMinor: '1' });
    await withCsrf(user.agent.post(`${ACCOUNTS}/${old.account.id}/archive`), user).expect(200);

    const summary = apiSuccessResponseSchema(accountSummaryDtoSchema).parse(
      (await user.agent.get(`${ACCOUNTS}/summary`).expect(200)).body,
    ).data;

    expect(summary.currencies.map((entry) => [entry.currency, entry.assetsMinor])).toEqual([
      ['INR', '5000000'],
      ['USD', '25000'],
    ]);
  });

  it('ignores rows that belong to another user even if they reference the account', async () => {
    const context = createContext();
    const alice = await newUser(context);
    const mallory = await newUser(context);
    const bank = await createAccount(alice, BANK);

    await record(alice, 'expense', bank.account.id, 1_000_000n, {
      userId: mallory.session.user.id,
    });

    expect((await getAccount(alice, bank.account.id)).balance.currentBalanceMinor).toBe('5000000');
  });
});

describe('database integrity and failures', () => {
  it('keeps currency and credit-limit constraints in the database', async () => {
    const context = createContext();
    const user = await newUser(context);
    const bank = await createAccount(user, BANK);

    await expect(
      prisma.account.update({ where: { id: bank.account.id }, data: { creditLimitMinor: 1000n } }),
    ).rejects.toThrow();
    await expect(
      prisma.account.update({ where: { id: bank.account.id }, data: { currency: 'inr' } }),
    ).rejects.toThrow();
  });

  it('answers database failures with a safe, generic error', async () => {
    const context = createContext({
      accountsRepository: (real) => ({
        ...real,
        list: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret')),
      }),
    });
    const user = await newUser(context);

    const response = await user.agent.get(ACCOUNTS).expect(500);

    const error = apiErrorResponseSchema.parse(response.body).error;
    expect(error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|secret|ECONNREFUSED/);
  });
});
