import { describe, expect, it } from 'vitest';

import {
  balanceOf,
  categoryId,
  createAccount,
  hoursAgo,
  newUser,
  parseItem,
  postTransaction,
  TRANSACTIONS,
} from '../../testing/finance-helpers';
import { useIntegrationDatabase, withCsrf } from '../../testing/integration-harness';

// These tests send real requests in parallel. Each one runs its own database transaction on its own
// pooled connection, so they exercise PostgreSQL's row locks rather than any in-process ordering.

const { prisma, createContext } = useIntegrationDatabase();

const OPENED = '2025-01-01';

describe('concurrent writes', () => {
  it('never lets simultaneous expenses overdraw a cash account', async () => {
    const context = createContext();
    const user = await newUser(context);
    const cash = (
      await createAccount(user, {
        name: 'Cash',
        type: 'cash',
        currency: 'INR',
        openingBalanceMinor: '100000',
        openingBalanceDate: OPENED,
      })
    ).account.id;
    const food = await categoryId(user, 'expense', 'Food');

    // ₹1,000 in cash and twelve ₹300 payments at once: exactly three fit.
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        postTransaction(user, {
          type: 'expense',
          accountId: cash,
          amountMinor: '30000',
          occurredAt: hoursAgo(context.clock.now(), 1),
          description: `Snack ${index}`,
          categoryId: food,
        }),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);
    expect(await balanceOf(user, cash)).toBe(10_000n);
    expect(await prisma.transaction.count()).toBe(3);
  });

  it('applies crossing transfers completely and without deadlocks', async () => {
    const context = createContext();
    const user = await newUser(context);
    const account = async (name: string): Promise<string> =>
      (
        await createAccount(user, {
          name,
          type: 'savings',
          currency: 'INR',
          openingBalanceMinor: '1000000',
          openingBalanceDate: OPENED,
        })
      ).account.id;
    const [a, b, c] = [await account('A'), await account('B'), await account('C')];
    const pairs: [string, string][] = [
      [a, b],
      [b, a],
      [b, c],
      [c, a],
      [a, c],
      [c, b],
    ];

    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, index) => {
        const [from, to] = pairs[index % pairs.length] ?? [a, b];
        return postTransaction(user, {
          type: 'transfer',
          accountId: from,
          transferAccountId: to,
          amountMinor: '1000',
          occurredAt: hoursAgo(context.clock.now(), 1),
        });
      }),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(24).fill(201));
    // Every account sent and received the same number of equal transfers.
    expect(await balanceOf(user, a)).toBe(1_000_000n);
    expect(await balanceOf(user, b)).toBe(1_000_000n);
    expect(await balanceOf(user, c)).toBe(1_000_000n);
    expect(await prisma.transaction.count()).toBe(24);
  });

  it('serialises an edit and a void of the same transaction', async () => {
    const context = createContext();
    const user = await newUser(context);
    const wallet = (
      await createAccount(user, {
        name: 'UPI wallet',
        type: 'digital_wallet',
        currency: 'INR',
        openingBalanceMinor: '50000',
        openingBalanceDate: OPENED,
      })
    ).account.id;
    const created = await postTransaction(user, {
      type: 'expense',
      accountId: wallet,
      amountMinor: '10000',
      occurredAt: hoursAgo(context.clock.now(), 1),
      description: 'Recharge',
      categoryId: await categoryId(user, 'expense', 'Utilities'),
    }).expect(201);
    const id = parseItem(created.body).transaction.id;

    const [edit, voided] = await Promise.all([
      withCsrf(user.agent.patch(`${TRANSACTIONS}/${id}`), user).send({ amountMinor: '20000' }),
      withCsrf(user.agent.post(`${TRANSACTIONS}/${id}/void`), user).send({}),
    ]);

    expect(voided.status).toBe(200);
    // Either the edit ran first (then the void removed it) or it found the row voided.
    expect([200, 409]).toContain(edit.status);
    expect(await balanceOf(user, wallet)).toBe(50_000n);
  });
});

describe('failed multi-account writes', () => {
  it('leaves both accounts unchanged when a transfer fails half-way', async () => {
    const context = createContext({
      transactionsRepository: (real) => ({
        ...real,
        inLedger: (work) =>
          real.inLedger((ledger) =>
            work({
              ...ledger,
              insert: async (...args) => {
                await ledger.insert(...args);
                throw new Error('Simulated failure after the row was written');
              },
            }),
          ),
      }),
    });
    const user = await newUser(context);
    const account = async (name: string): Promise<string> =>
      (
        await createAccount(user, {
          name,
          type: 'bank',
          currency: 'INR',
          openingBalanceMinor: '500000',
          openingBalanceDate: OPENED,
        })
      ).account.id;
    const [from, to] = [await account('From'), await account('To')];

    const response = await postTransaction(user, {
      type: 'transfer',
      accountId: from,
      transferAccountId: to,
      amountMinor: '100000',
      occurredAt: hoursAgo(context.clock.now(), 1),
    });

    expect(response.status).toBe(500);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await balanceOf(user, from)).toBe(500_000n);
    expect(await balanceOf(user, to)).toBe(500_000n);
  });
});
