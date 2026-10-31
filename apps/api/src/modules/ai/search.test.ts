import type { AccountDto, CategoryDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { formatRange } from '../../lib/text-format';
import { createFakeAiProvider } from '../../testing/fake-ai-provider';
import { interpretSearch } from './search';
import { ruleBasedMerchant } from './suggestions';
import type { UserReferences } from './tools';

const USER = '00000000-0000-4000-8000-000000000001';
const HDFC = '00000000-0000-4000-8000-0000000000a1';
const FOOD = '00000000-0000-4000-8000-0000000000c1';
const STAMP = '2026-01-01T00:00:00.000Z';

const hdfc: AccountDto = {
  id: HDFC,
  userId: USER,
  name: 'HDFC Savings',
  type: 'bank',
  classification: 'asset',
  currency: 'INR',
  openingBalanceMinor: '0',
  openingBalanceDate: '2026-01-01',
  status: 'active',
  createdAt: STAMP,
  updatedAt: STAMP,
};

const food: CategoryDto = {
  id: FOOD,
  userId: USER,
  name: 'Food & Dining',
  kind: 'expense',
  status: 'active',
  createdAt: STAMP,
  updatedAt: STAMP,
};

const REFS: UserReferences = { accounts: [hdfc], categories: [food] };
const CALLER = { userId: USER, timeZone: 'Asia/Kolkata', preferredCurrency: 'INR' } as const;
const NOW = new Date('2026-10-29T04:30:00.000Z');

describe('interpretSearch', () => {
  it('turns a question into validated filters with a chip for each', async () => {
    const provider = createFakeAiProvider();
    provider.reply({
      understood: true,
      type: 'expense',
      category: 'food',
      account: 'hdfc',
      minAmount: '2000',
      period: 'last-month',
      sort: 'largest',
    });

    const result = await interpretSearch(
      provider,
      CALLER,
      'food expenses above 2,000 from HDFC last month, largest first',
      REFS,
      NOW,
    );

    expect(result).toEqual({
      kind: 'filters',
      query: 'food expenses above 2,000 from HDFC last month, largest first',
      filters: {
        type: 'expense',
        categoryId: FOOD,
        accountId: HDFC,
        minAmount: '2000',
        from: '2026-09-01',
        to: '2026-09-30',
        sort: 'largest',
      },
      chips: [
        { key: 'type', label: 'Expenses' },
        { key: 'categoryId', label: 'Category: Food & Dining' },
        { key: 'accountId', label: 'Account: HDFC Savings' },
        { key: 'minAmount', label: 'At least 2000' },
        { key: 'from', label: formatRange('2026-09-01', '2026-09-30') },
        { key: 'sort', label: 'Largest first' },
      ],
      unresolved: [],
    });
  });

  it('drops amounts, words, types, and periods the person did not write', async () => {
    const provider = createFakeAiProvider();
    provider.reply({
      understood: true,
      type: 'income',
      text: 'netflix',
      maxAmount: '999999',
      period: 'this-month',
    });

    const result = await interpretSearch(provider, CALLER, 'swiggy orders in usd', REFS, NOW);

    expect(result.kind).toBe('filters');
    expect(result.kind === 'filters' && result.filters).toEqual({ currency: 'USD' });
  });

  it('reads the question itself when a small model gets it wrong', async () => {
    const provider = createFakeAiProvider();
    // Seen with a small local model: the wrong type and the whole question as search text.
    provider.reply({ understood: true, type: 'transfer', text: 'food expenses above 2000' });
    const foodOnly: UserReferences = {
      accounts: [hdfc],
      categories: [
        { ...food, name: 'Food' },
        { ...food, id: '00000000-0000-4000-8000-0000000000c2', name: 'Food delivery' },
      ],
    };

    const result = await interpretSearch(
      provider,
      CALLER,
      'food expenses above ₹2,000 in the past 3 months, smallest first',
      foodOnly,
      NOW,
    );

    expect(result.kind === 'filters' && result.filters).toEqual({
      type: 'expense',
      categoryId: FOOD,
      minAmount: '2000',
      from: '2026-08-01',
      to: '2026-10-29',
      sort: 'smallest',
    });
  });

  it('prefers the full category name written over a shorter one inside it', async () => {
    const provider = createFakeAiProvider();
    provider.reply({ understood: true, text: 'swiggy' });
    const delivery = '00000000-0000-4000-8000-0000000000c2';
    const refs: UserReferences = {
      accounts: [],
      categories: [
        { ...food, name: 'Food' },
        { ...food, id: delivery, name: 'Food delivery' },
      ],
    };

    const result = await interpretSearch(provider, CALLER, 'food delivery from swiggy', refs, NOW);

    expect(result.kind === 'filters' && result.filters).toEqual({
      categoryId: delivery,
      q: 'swiggy',
    });
  });

  it('names categories and accounts it could not find, without guessing', async () => {
    const provider = createFakeAiProvider();
    provider.reply({ understood: true, category: 'yachts' });

    const result = await interpretSearch(provider, CALLER, 'yachts', REFS, NOW);

    expect(result).toMatchObject({
      kind: 'not_understood',
      reason: 'None of your categories or accounts is called “yachts”.',
    });
  });

  it('declines requests that are not searches', async () => {
    const provider = createFakeAiProvider();
    provider.reply({ understood: false });

    const result = await interpretSearch(provider, CALLER, 'write me a poem', REFS, NOW);

    expect(result.kind).toBe('not_understood');
  });
});

describe('ruleBasedMerchant', () => {
  it.each([
    ['AMZN Mktp IN*2Q4', 'Amazon'],
    ['POS SWIGGY BANGALORE', 'Swiggy'],
    ['UPI/RAHUL123/9876543210/Payment', 'Rahul'],
    ['UPI-ASHA KUMAR-asha@okicici-HDFC0001', 'Asha Kumar'],
  ])('reads %s as %s', (description, merchant) => {
    expect(ruleBasedMerchant(description)).toBe(merchant);
  });

  it.each(['NEFT 0001234', 'UPI/12345/xyz', 'Cash withdrawal'])('leaves %s alone', (text) => {
    expect(ruleBasedMerchant(text)).toBeUndefined();
  });
});
