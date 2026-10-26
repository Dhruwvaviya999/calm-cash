import type { TransactionDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  buildCreateTransactionInput,
  buildReconciliationInput,
  buildUpdateTransactionInput,
  emptyTransactionFormValues,
  transactionErrorsFromPaths,
  transactionToFormValues,
  type FormAccount,
  type TransactionFormValues,
} from './transaction-form-model';

const BANK: FormAccount = {
  id: '0193a000-0000-7000-8000-000000000201',
  name: 'HDFC',
  type: 'bank',
  currency: 'INR',
  status: 'active',
};
const CASH: FormAccount = {
  ...BANK,
  id: '0193a000-0000-7000-8000-000000000202',
  name: 'Cash',
  type: 'cash',
};
const CARD: FormAccount = {
  ...BANK,
  id: '0193a000-0000-7000-8000-000000000203',
  name: 'Card',
  type: 'credit_card',
};
const YEN: FormAccount = {
  ...BANK,
  id: '0193a000-0000-7000-8000-000000000204',
  name: 'Tokyo',
  currency: 'JPY',
};
const ACCOUNTS = [BANK, CASH, CARD, YEN];
const GROCERIES = '0193a000-0000-7000-8000-000000000101';
const ZONE = 'Asia/Kolkata';
const NOW = new Date('2026-10-26T06:00:00.000Z');

function values(overrides: Partial<TransactionFormValues>): TransactionFormValues {
  return { ...emptyTransactionFormValues('expense', ZONE, NOW), ...overrides };
}

describe('buildCreateTransactionInput', () => {
  it('builds an exact expense in the account’s currency and the user’s time zone', () => {
    const result = buildCreateTransactionInput(
      values({
        accountId: BANK.id,
        amount: '1,25,000.50',
        date: '2026-10-26',
        time: '00:15',
        merchant: ' FreshMart ',
        description: 'Groceries',
        categoryId: GROCERIES,
        paymentMethod: 'upi',
        tags: 'family,work',
        notes: '  ',
      }),
      ACCOUNTS,
      ZONE,
    );
    expect(result).toEqual({
      ok: true,
      input: {
        type: 'expense',
        accountId: BANK.id,
        amountMinor: '12500050',
        // 00:15 in Kolkata is 18:45 UTC the day before.
        occurredAt: '2026-10-25T18:45:00.000Z',
        description: 'Groceries',
        categoryId: GROCERIES,
        merchant: 'FreshMart',
        paymentMethod: 'upi',
        tags: ['family', 'work'],
      },
    });
  });

  it('reports precision, zero amounts, and missing selections in plain words', () => {
    const tooPrecise = buildCreateTransactionInput(
      values({ accountId: YEN.id, amount: '10.5', description: 'Lunch', categoryId: GROCERIES }),
      ACCOUNTS,
      ZONE,
    );
    expect(!tooPrecise.ok && tooPrecise.errors.amount).toBe('JPY amounts have no decimal places.');

    const empty = buildCreateTransactionInput(
      values({ accountId: BANK.id, amount: '0' }),
      ACCOUNTS,
      ZONE,
    );
    expect(!empty.ok && empty.errors).toMatchObject({
      amount: 'Enter an amount above zero.',
      categoryId: 'Choose a category.',
      description: 'Describe what this was for.',
    });

    const negative = buildCreateTransactionInput(
      values({ accountId: BANK.id, amount: '-5' }),
      ACCOUNTS,
      ZONE,
    );
    expect(!negative.ok && negative.errors.amount).toBe('Enter an amount above zero.');
  });

  it('builds transfers only between two different accounts of one currency', () => {
    const transfer = (to: string): ReturnType<typeof buildCreateTransactionInput> =>
      buildCreateTransactionInput(
        values({ type: 'transfer', accountId: BANK.id, transferAccountId: to, amount: '100' }),
        ACCOUNTS,
        ZONE,
      );
    expect(transfer(CASH.id)).toMatchObject({
      ok: true,
      input: { type: 'transfer', transferAccountId: CASH.id, amountMinor: '10000' },
    });
    expect(transfer(BANK.id)).toMatchObject({
      ok: false,
      errors: { transferAccountId: 'Choose two different accounts.' },
    });
    const crossCurrency = transfer(YEN.id);
    expect(!crossCurrency.ok && crossCurrency.errors.transferAccountId).toContain('one currency');
  });

  it('never sends fields of another type', () => {
    const result = buildCreateTransactionInput(
      values({
        type: 'transfer',
        accountId: BANK.id,
        transferAccountId: CASH.id,
        amount: '1',
        merchant: 'Left over from an expense',
        categoryId: GROCERIES,
      }),
      ACCOUNTS,
      ZONE,
    );
    expect(result.ok && result.input).not.toHaveProperty('merchant');
    expect(result.ok && result.input).not.toHaveProperty('categoryId');
  });
});

describe('buildUpdateTransactionInput', () => {
  const stored: TransactionDto = {
    id: '0193a000-0000-7000-8000-000000000301',
    userId: '0193a000-0000-7000-8000-000000000001',
    type: 'expense',
    accountId: BANK.id,
    amountMinor: '245000',
    currency: 'INR',
    description: 'Groceries',
    merchant: 'FreshMart',
    categoryId: GROCERIES,
    tags: ['family'],
    status: 'active',
    occurredAt: '2026-10-20T10:00:00.000Z',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  it('shows a stored transaction exactly and sends nothing when nothing changed', () => {
    const form = transactionToFormValues(stored, ZONE);
    expect(form).toMatchObject({
      amount: '2450.00',
      date: '2026-10-20',
      time: '15:30',
      tags: 'family',
    });
    expect(buildUpdateTransactionInput(stored, form, ACCOUNTS, ZONE)).toEqual({
      ok: true,
      input: undefined,
    });
  });

  it('sends only what changed', () => {
    const form = { ...transactionToFormValues(stored, ZONE), amount: '2500', tags: '' };
    expect(buildUpdateTransactionInput(stored, form, ACCOUNTS, ZONE)).toEqual({
      ok: true,
      input: { amountMinor: '250000', tags: [] },
    });
  });

  it('clears every field the new type does not use when the type changes', () => {
    const form = {
      ...transactionToFormValues(stored, ZONE),
      type: 'transfer',
      transferAccountId: CASH.id,
    };
    expect(buildUpdateTransactionInput(stored, form, ACCOUNTS, ZONE)).toEqual({
      ok: true,
      input: { type: 'transfer', transferAccountId: CASH.id, merchant: null, categoryId: null },
    });
  });
});

describe('buildReconciliationInput', () => {
  const base = {
    observed: '',
    date: '2026-10-26',
    time: '12:00',
    description: 'Statement',
    notes: '',
  };

  it('turns the amount owed on a card into a negative net position', () => {
    expect(
      buildReconciliationInput({ ...base, accountId: CARD.id, observed: '13,000' }, ACCOUNTS, ZONE),
    ).toEqual({
      ok: true,
      input: {
        accountId: CARD.id,
        observedBalanceMinor: '-1300000',
        asOf: '2026-10-26T06:30:00.000Z',
      },
    });
  });

  it('refuses a negative balance for cash and requires a reason', () => {
    const result = buildReconciliationInput(
      { ...base, accountId: CASH.id, observed: '-5', description: ' ' },
      ACCOUNTS,
      ZONE,
    );
    expect(!result.ok && result.errors).toEqual({
      observed: 'This type of account cannot have a negative balance.',
      description: 'Explain why the balance needs correcting.',
    });
  });

  it('allows an overdraft for a bank account', () => {
    const result = buildReconciliationInput(
      { ...base, accountId: BANK.id, observed: '-250.75' },
      ACCOUNTS,
      ZONE,
    );
    expect(result.ok && result.input.observedBalanceMinor).toBe('-25075');
  });
});

describe('transactionErrorsFromPaths', () => {
  it('maps API paths onto form fields', () => {
    expect(
      transactionErrorsFromPaths([
        { path: 'body.amountMinor', message: 'Not enough money.' },
        { path: 'body.occurredAt', message: 'Too early.' },
        { path: 'body.tags.2', message: 'Bad tag.' },
        { path: 'headers.idempotency-key', message: 'Ignored.' },
      ]),
    ).toEqual({ amount: 'Not enough money.', date: 'Too early.', tags: 'Bad tag.' });
  });
});
