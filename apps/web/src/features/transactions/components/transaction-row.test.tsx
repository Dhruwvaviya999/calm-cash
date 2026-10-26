import type { AccountDto, CategoryDto, TransactionDto } from '@calmcash/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TransactionRow } from './transaction-row';

const audit = {
  userId: '0193a000-0000-7000-8000-000000000001',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as const;

const savings: AccountDto = {
  id: '0193a000-0000-7000-8000-000000000201',
  name: 'Everyday Savings',
  type: 'savings',
  classification: 'asset',
  currency: 'INR',
  openingBalanceMinor: '0',
  openingBalanceDate: '2026-10-01',
  status: 'active',
  ...audit,
};

const card: AccountDto = {
  ...savings,
  id: '0193a000-0000-7000-8000-000000000202',
  name: 'Rewards Card',
  type: 'credit_card',
  classification: 'liability',
};

const groceries: CategoryDto = {
  id: '0193a000-0000-7000-8000-000000000101',
  name: 'Groceries',
  kind: 'expense',
  ...audit,
};

const text = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('TransactionRow', () => {
  it('shows who, why, when, category, payment account, and amount', () => {
    const transaction: TransactionDto = {
      id: '0193a000-0000-7000-8000-000000000301',
      type: 'expense',
      accountId: card.id,
      categoryId: groceries.id,
      merchant: 'FreshMart',
      description: 'Weekly groceries',
      amountMinor: '245000',
      currency: 'INR',
      occurredAt: '2026-10-23T12:45:00.000Z',
      ...audit,
    };
    const markup = renderToStaticMarkup(
      <TransactionRow item={{ transaction, account: card, category: groceries }} />,
    );

    const visible = text(markup);
    for (const expected of [
      'FreshMart',
      'Weekly groceries',
      '23 Oct',
      'Groceries',
      'Rewards Card',
      '₹2,450.00',
    ]) {
      expect(visible).toContain(expected);
    }
    expect(markup).toContain('dateTime="2026-10-23T12:45:00.000Z"');
  });

  it('names the destination of a transfer and marks it as a transfer', () => {
    const transaction: TransactionDto = {
      id: '0193a000-0000-7000-8000-000000000307',
      type: 'transfer',
      accountId: savings.id,
      transferAccountId: card.id,
      description: 'Credit card bill payment',
      amountMinor: '1250000',
      currency: 'INR',
      occurredAt: '2026-10-18T05:00:00.000Z',
      ...audit,
    };
    const visible = text(
      renderToStaticMarkup(
        <TransactionRow item={{ transaction, account: savings, transferAccount: card }} />,
      ),
    );

    expect(visible).toContain('To Rewards Card');
    expect(visible).toContain('Transfer');
    expect(visible).toContain('Everyday Savings');
  });
});
