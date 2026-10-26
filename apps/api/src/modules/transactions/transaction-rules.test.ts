import type { CreateTransactionInput } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/app-error';
import { NO_MOVEMENTS } from '../accounts';
import {
  assertBalanceRules,
  mergeTransactionUpdate,
  planTransactionWrite,
  type WriteContext,
} from './transaction-rules';
import type { CategoryRecord, LockedAccount, TransactionRecord } from './transactions.repository';

const USER = '0193a000-0000-7000-8000-000000000001';
const BANK = '0193a000-0000-7000-8000-000000000201';
const CASH = '0193a000-0000-7000-8000-000000000202';
const USD = '0193a000-0000-7000-8000-000000000203';
const GROCERIES = '0193a000-0000-7000-8000-000000000101';
const SALARY = '0193a000-0000-7000-8000-000000000102';
const CREATED = new Date('2026-01-01T00:00:00.000Z');
const NOW = new Date('2026-10-26T06:00:00.000Z'); // 11:30 in Kolkata

function account(id: string, overrides: Partial<LockedAccount['record']> = {}): LockedAccount {
  return {
    record: {
      id,
      userId: USER,
      name: id === CASH ? 'Wallet cash' : id === USD ? 'US bank' : 'HDFC',
      type: id === CASH ? 'cash' : 'bank',
      currency: id === USD ? 'USD' : 'INR',
      openingBalanceMinor: 100_000n,
      openingBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      institution: null,
      creditLimitMinor: null,
      color: null,
      archivedAt: null,
      createdAt: CREATED,
      updatedAt: CREATED,
      ...overrides,
    },
    // Midnight of 1 Jan 2026 in Kolkata.
    countsFrom: new Date('2025-12-31T18:30:00.000Z'),
  };
}

function category(id: string, overrides: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    id,
    userId: USER,
    name: id === SALARY ? 'Salary' : 'Groceries',
    kind: id === SALARY ? 'income' : 'expense',
    parentId: null,
    archivedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

const record: TransactionRecord = {
  id: '0193a000-0000-7000-8000-000000000301',
  userId: USER,
  accountId: BANK,
  type: 'expense',
  amountMinor: 245_000n,
  currency: 'INR',
  description: 'Weekly groceries',
  merchant: 'FreshMart',
  categoryId: GROCERIES,
  transferAccountId: null,
  adjustmentDirection: null,
  paymentMethod: 'upi',
  notes: 'Paid with points',
  tags: ['family'],
  idempotencyKey: null,
  voidedAt: null,
  voidReason: null,
  occurredAt: new Date('2026-10-20T10:00:00.000Z'),
  createdAt: CREATED,
  updatedAt: CREATED,
};

const expense: CreateTransactionInput = {
  type: 'expense',
  accountId: BANK,
  amountMinor: '245000',
  occurredAt: '2026-10-20T10:00:00.000Z',
  description: 'Weekly groceries',
  categoryId: GROCERIES,
};

function context(overrides: Partial<WriteContext> = {}): WriteContext {
  return {
    accounts: new Map([
      [BANK, account(BANK)],
      [CASH, account(CASH)],
      [USD, account(USD)],
    ]),
    category: category(GROCERIES),
    timeZone: 'Asia/Kolkata',
    now: NOW,
    ...overrides,
  };
}

function failure(run: () => unknown): AppError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an AppError.');
}

describe('mergeTransactionUpdate', () => {
  it('keeps unmentioned fields, replaces given ones, and clears nulls', () => {
    const result = mergeTransactionUpdate(record, { amountMinor: '1000', notes: null, tags: [] });
    expect(result).toEqual({
      ok: true,
      input: {
        type: 'expense',
        accountId: BANK,
        amountMinor: '1000',
        occurredAt: '2026-10-20T10:00:00.000Z',
        description: 'Weekly groceries',
        merchant: 'FreshMart',
        categoryId: GROCERIES,
        paymentMethod: 'upi',
        tags: [],
      },
    });
  });

  it('reports every field the new type cannot carry instead of dropping it', () => {
    const result = mergeTransactionUpdate(record, { type: 'transfer', transferAccountId: CASH });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toEqual([
        { path: 'body.merchant', message: 'Not used for transfers. Send null to remove it.' },
        { path: 'body.categoryId', message: 'Not used for transfers. Send null to remove it.' },
      ]);
    }
  });

  it('accepts a type change once the result is consistent', () => {
    const result = mergeTransactionUpdate(record, {
      type: 'balance_adjustment',
      adjustmentDirection: 'decrease',
      merchant: null,
      categoryId: null,
      paymentMethod: null,
    });
    expect(result.ok && result.input.type).toBe('balance_adjustment');
  });

  it('reports missing required fields of the new type', () => {
    const result = mergeTransactionUpdate(record, {
      type: 'transfer',
      merchant: null,
      categoryId: null,
    });
    expect(!result.ok && result.details.map((detail) => detail.path)).toEqual([
      'body.transferAccountId',
    ]);
  });
});

describe('planTransactionWrite', () => {
  it('derives the currency from the account and fills absent optional columns with null', () => {
    expect(planTransactionWrite(expense, context())).toEqual({
      type: 'expense',
      accountId: BANK,
      transferAccountId: null,
      amountMinor: 245_000n,
      currency: 'INR',
      description: 'Weekly groceries',
      merchant: null,
      categoryId: GROCERIES,
      paymentMethod: null,
      adjustmentDirection: null,
      notes: null,
      tags: [],
      occurredAt: new Date('2026-10-20T10:00:00.000Z'),
    });
  });

  it('gives a transfer a default description and never a category', () => {
    const write = planTransactionWrite(
      {
        type: 'transfer',
        accountId: BANK,
        transferAccountId: CASH,
        amountMinor: '500',
        occurredAt: '2026-10-20T10:00:00.000Z',
      },
      context({ category: null }),
    );
    expect(write).toMatchObject({
      description: 'Transfer between accounts',
      categoryId: null,
      transferAccountId: CASH,
    });
  });

  it('refuses accounts that are not the user’s, archived, or in another currency', () => {
    const notMine = failure(() =>
      planTransactionWrite(
        { ...expense, accountId: '0193a000-0000-7000-8000-000000000999' },
        context(),
      ),
    );
    expect([notMine.statusCode, notMine.details?.[0]?.path]).toEqual([400, 'body.accountId']);

    const archived = failure(() =>
      planTransactionWrite(
        expense,
        context({ accounts: new Map([[BANK, account(BANK, { archivedAt: NOW })]]) }),
      ),
    );
    expect(archived.statusCode).toBe(409);

    const crossCurrency = failure(() =>
      planTransactionWrite(
        {
          type: 'transfer',
          accountId: BANK,
          transferAccountId: USD,
          amountMinor: '500',
          occurredAt: '2026-10-20T10:00:00.000Z',
        },
        context({ category: null }),
      ),
    );
    expect(crossCurrency.details?.[0]?.path).toBe('body.transferAccountId');
  });

  it('judges dates in the user’s time zone and against the opening date', () => {
    // 18:29 UTC on 31 Dec 2025 is 23:59 in Kolkata, before the account is tracked.
    const early = failure(() =>
      planTransactionWrite({ ...expense, occurredAt: '2025-12-31T18:29:00.000Z' }, context()),
    );
    expect(early.details?.[0]?.message).toContain('tracked from 2026-01-01');
    expect(() =>
      planTransactionWrite({ ...expense, occurredAt: '2025-12-31T18:30:00.000Z' }, context()),
    ).not.toThrow();

    // Later today in Kolkata is fine; tomorrow there is in the future.
    expect(() =>
      planTransactionWrite({ ...expense, occurredAt: '2026-10-26T18:29:00.000Z' }, context()),
    ).not.toThrow();
    const future = failure(() =>
      planTransactionWrite({ ...expense, occurredAt: '2026-10-26T18:30:00.000Z' }, context()),
    );
    expect(future.details?.[0]?.path).toBe('body.occurredAt');
  });

  it('requires a category of the matching kind, and an active one unless it is unchanged', () => {
    const wrongKind = failure(() =>
      planTransactionWrite(
        { ...expense, categoryId: SALARY },
        context({ category: category(SALARY) }),
      ),
    );
    expect(wrongKind.details?.[0]?.message).toBe('Choose an expense category.');

    const archived = category(GROCERIES, { archivedAt: NOW });
    expect(
      failure(() => planTransactionWrite(expense, context({ category: archived }))).statusCode,
    ).toBe(400);
    expect(() =>
      planTransactionWrite(expense, context({ category: archived, existing: record })),
    ).not.toThrow();

    const missing = failure(() => planTransactionWrite(expense, context({ category: null })));
    expect(missing.details?.[0]?.path).toBe('body.categoryId');
  });
});

describe('assertBalanceRules', () => {
  const accounts = new Map([
    [CASH, account(CASH)],
    [BANK, account(BANK)],
  ]);

  it('refuses a result that takes cash below zero', () => {
    const after = new Map([[CASH, { ...NO_MOVEMENTS, expenseMinor: 100_001n, counted: 1 }]]);
    const error = failure(() => {
      assertBalanceRules(accounts, new Map(), after, 'body.amountMinor');
    });
    expect([error.statusCode, error.details?.[0]?.path]).toEqual([409, 'body.amountMinor']);
  });

  it('allows a bank overdraft and an exact zero', () => {
    const after = new Map([
      [BANK, { ...NO_MOVEMENTS, expenseMinor: 500_000n, counted: 1 }],
      [CASH, { ...NO_MOVEMENTS, expenseMinor: 100_000n, counted: 1 }],
    ]);
    expect(() => {
      assertBalanceRules(accounts, new Map(), after, undefined);
    }).not.toThrow();
  });
});
