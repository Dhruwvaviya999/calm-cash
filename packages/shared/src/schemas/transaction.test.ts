import { describe, expect, it } from 'vitest';

import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import { createCategoryInputSchema, updateCategoryInputSchema } from './category';
import {
  bulkTransactionInputSchema,
  createReconciliationInputSchema,
  createTransactionInputSchema,
  reconciliationPreviewInputSchema,
  transactionFilterQuerySchema,
  transactionListQuerySchema,
  updateTransactionInputSchema,
  voidTransactionInputSchema,
} from './transaction';

const ACCOUNT_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70';
const OTHER_ACCOUNT_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e71';
const CATEGORY_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e72';
const OCCURRED_AT = '2026-10-25T09:30:00.000Z';

const expense = {
  type: 'expense',
  accountId: ACCOUNT_ID,
  amountMinor: '45000',
  occurredAt: OCCURRED_AT,
  description: 'Weekly groceries',
  categoryId: CATEGORY_ID,
  merchant: 'FreshMart',
} as const;

const transfer = {
  type: 'transfer',
  accountId: ACCOUNT_ID,
  transferAccountId: OTHER_ACCOUNT_ID,
  amountMinor: '500000',
  occurredAt: OCCURRED_AT,
} as const;

const adjustment = {
  type: 'balance_adjustment',
  accountId: ACCOUNT_ID,
  adjustmentDirection: 'decrease',
  amountMinor: '1250',
  occurredAt: OCCURRED_AT,
  description: 'Matched to bank statement',
} as const;

function paths(result: { error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

describe('createTransactionInputSchema', () => {
  it('discriminates on the type and trims text', () => {
    const parsed = createTransactionInputSchema.parse({
      ...expense,
      description: '  Weekly groceries ',
      merchant: ' FreshMart',
    });
    expect(parsed).toEqual(expense);
    expect(parsed.type).toBe('expense');
  });

  it('accepts each transaction type with its own fields', () => {
    expect(createTransactionInputSchema.safeParse({ ...expense, type: 'income' }).success).toBe(
      true,
    );
    expect(createTransactionInputSchema.safeParse(transfer).success).toBe(true);
    expect(createTransactionInputSchema.safeParse(adjustment).success).toBe(true);
  });

  it('requires a category and a description for income and expenses', () => {
    const { categoryId: _category, ...uncategorised } = expense;
    expect(paths(createTransactionInputSchema.safeParse(uncategorised))).toEqual(['categoryId']);
    expect(
      paths(createTransactionInputSchema.safeParse({ ...expense, description: '  ' })),
    ).toEqual(['description']);
  });

  it('rejects fields that belong to another type instead of ignoring them', () => {
    for (const body of [
      { ...transfer, categoryId: CATEGORY_ID },
      { ...transfer, merchant: 'Bank' },
      { ...expense, transferAccountId: OTHER_ACCOUNT_ID },
      { ...expense, adjustmentDirection: 'increase' },
      { ...adjustment, categoryId: CATEGORY_ID },
      { ...adjustment, paymentMethod: 'cash' },
    ]) {
      const result = createTransactionInputSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    }
  });

  it('rejects owner, currency, and status fields', () => {
    for (const extra of [
      { userId: ACCOUNT_ID },
      { currency: 'INR' },
      { status: 'voided' },
      { id: ACCOUNT_ID },
    ]) {
      expect(createTransactionInputSchema.safeParse({ ...expense, ...extra }).success).toBe(false);
    }
  });

  it('requires two distinct accounts for a transfer', () => {
    expect(
      paths(createTransactionInputSchema.safeParse({ ...transfer, transferAccountId: ACCOUNT_ID })),
    ).toEqual(['transferAccountId']);
    const { transferAccountId: _destination, ...withoutDestination } = transfer;
    expect(paths(createTransactionInputSchema.safeParse(withoutDestination))).toEqual([
      'transferAccountId',
    ]);
  });

  it('requires a direction and a reason for balance adjustments', () => {
    const { adjustmentDirection: _direction, ...withoutDirection } = adjustment;
    expect(paths(createTransactionInputSchema.safeParse(withoutDirection))).toEqual([
      'adjustmentDirection',
    ]);
    const { description: _reason, ...withoutReason } = adjustment;
    const result = createTransactionInputSchema.safeParse(withoutReason);
    expect(paths(result)).toEqual(['description']);
    expect(result.error?.issues[0]?.message).toBe('Explain why the balance needs correcting.');
  });

  it('accepts only positive, canonical minor units within the enterable range', () => {
    for (const amountMinor of ['0', '-100', '12.50', '1e3', '007', 4500, '']) {
      expect(createTransactionInputSchema.safeParse({ ...expense, amountMinor }).success).toBe(
        false,
      );
    }
    expect(
      createTransactionInputSchema.safeParse({
        ...expense,
        amountMinor: MAX_ENTERED_AMOUNT_MINOR.toString(),
      }).success,
    ).toBe(true);
    expect(
      createTransactionInputSchema.safeParse({
        ...expense,
        amountMinor: (MAX_ENTERED_AMOUNT_MINOR + 1n).toString(),
      }).success,
    ).toBe(false);
  });

  it('requires UTC timestamps after 1900', () => {
    for (const occurredAt of ['2026-10-25', '2026-10-25T15:00:00+05:30', '1899-12-31T23:59:59Z']) {
      expect(createTransactionInputSchema.safeParse({ ...expense, occurredAt }).success).toBe(
        false,
      );
    }
  });

  it('rejects malformed IDs and unknown optional values', () => {
    expect(
      paths(createTransactionInputSchema.safeParse({ ...expense, accountId: 'acc-1' })),
    ).toEqual(['accountId']);
    expect(
      paths(createTransactionInputSchema.safeParse({ ...expense, paymentMethod: 'barter' })),
    ).toEqual(['paymentMethod']);
    expect(paths(createTransactionInputSchema.safeParse({ ...expense, notes: '' }))).toEqual([
      'notes',
    ]);
  });

  it('allows line breaks in notes but no other control characters in text', () => {
    expect(
      createTransactionInputSchema.safeParse({ ...expense, notes: 'Line one\nLine two' }).success,
    ).toBe(true);
    expect(
      createTransactionInputSchema.safeParse({ ...expense, description: 'Bad\u0007bell' }).success,
    ).toBe(false);
    expect(
      createTransactionInputSchema.safeParse({ ...expense, merchant: 'Two\nlines' }).success,
    ).toBe(false);
  });
});

describe('tags', () => {
  it('normalises, de-duplicates, and keeps the entered order', () => {
    const parsed = createTransactionInputSchema.parse({
      ...expense,
      tags: ['Work Trip', 'family', 'work-trip', ' FAMILY ', 'यात्रा'],
    });
    expect(parsed.tags).toEqual(['work-trip', 'family', 'यात्रा']);
  });

  it('rejects empty, oversized, punctuated, and too many tags', () => {
    for (const tags of [
      [''],
      ['   '],
      ['x'.repeat(33)],
      ['#work'],
      ['-work'],
      ['a/b'],
      Array.from({ length: 11 }, (_, index) => `tag${index}`),
    ]) {
      expect(createTransactionInputSchema.safeParse({ ...expense, tags }).success).toBe(false);
    }
    expect(
      createTransactionInputSchema.safeParse({ ...expense, tags: ['x'.repeat(32)] }).success,
    ).toBe(true);
  });
});

describe('updateTransactionInputSchema', () => {
  it('accepts partial changes and null to clear optional fields', () => {
    expect(
      updateTransactionInputSchema.parse({ merchant: null, notes: null, amountMinor: '100' }),
    ).toEqual({ merchant: null, notes: null, amountMinor: '100' });
  });

  it('rejects an empty update, unknown fields, and clearing required fields', () => {
    expect(updateTransactionInputSchema.safeParse({}).success).toBe(false);
    expect(updateTransactionInputSchema.safeParse({ userId: ACCOUNT_ID }).success).toBe(false);
    expect(updateTransactionInputSchema.safeParse({ description: null }).success).toBe(false);
    expect(updateTransactionInputSchema.safeParse({ amountMinor: null }).success).toBe(false);
    expect(updateTransactionInputSchema.safeParse({ type: 'refund' }).success).toBe(false);
  });
});

describe('reconciliation inputs', () => {
  const preview = { accountId: ACCOUNT_ID, observedBalanceMinor: '-1250000', asOf: OCCURRED_AT };

  it('accepts a signed observed balance (negative is owed)', () => {
    expect(reconciliationPreviewInputSchema.safeParse(preview).success).toBe(true);
    expect(
      reconciliationPreviewInputSchema.safeParse({ ...preview, observedBalanceMinor: '12.50' })
        .success,
    ).toBe(false);
  });

  it('requires a reason and a non-zero confirmed adjustment', () => {
    const create = { ...preview, description: 'Statement', expectedAdjustmentMinor: '-500' };
    expect(createReconciliationInputSchema.safeParse(create).success).toBe(true);
    expect(
      paths(createReconciliationInputSchema.safeParse({ ...create, expectedAdjustmentMinor: '0' })),
    ).toEqual(['expectedAdjustmentMinor']);
    const { description: _reason, ...withoutReason } = create;
    expect(paths(createReconciliationInputSchema.safeParse(withoutReason))).toEqual([
      'description',
    ]);
  });
});

describe('voidTransactionInputSchema', () => {
  it('accepts an optional reason only', () => {
    expect(voidTransactionInputSchema.safeParse({}).success).toBe(true);
    expect(voidTransactionInputSchema.safeParse({ reason: 'Duplicate' }).success).toBe(true);
    expect(voidTransactionInputSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(voidTransactionInputSchema.safeParse({ voidedAt: OCCURRED_AT }).success).toBe(false);
  });
});

describe('bulkTransactionInputSchema', () => {
  const ids = [ACCOUNT_ID, OTHER_ACCOUNT_ID];

  it('accepts each action with its own payload', () => {
    expect(
      bulkTransactionInputSchema.safeParse({
        action: 'set_category',
        transactionIds: ids,
        categoryId: CATEGORY_ID,
      }).success,
    ).toBe(true);
    expect(
      bulkTransactionInputSchema.parse({ action: 'add_tags', transactionIds: ids, tags: ['Work'] }),
    ).toEqual({ action: 'add_tags', transactionIds: ids, tags: ['work'] });
    expect(
      bulkTransactionInputSchema.safeParse({ action: 'void', transactionIds: ids }).success,
    ).toBe(true);
  });

  it('bounds the selection and rejects duplicates and malformed IDs', () => {
    const tooMany = Array.from(
      { length: 101 },
      (_, index) => `01920c3e-4f6a-7c3b-9d2e-${index.toString().padStart(12, '0')}`,
    );
    for (const transactionIds of [[], tooMany, [ACCOUNT_ID, ACCOUNT_ID], ['nope']]) {
      expect(bulkTransactionInputSchema.safeParse({ action: 'void', transactionIds }).success).toBe(
        false,
      );
    }
    expect(
      bulkTransactionInputSchema.safeParse({ action: 'add_tags', transactionIds: ids, tags: [] })
        .success,
    ).toBe(false);
    expect(
      bulkTransactionInputSchema.safeParse({ action: 'delete', transactionIds: ids }).success,
    ).toBe(false);
  });
});

describe('transaction list queries', () => {
  it('applies safe defaults', () => {
    expect(transactionListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sort: 'newest',
      status: 'active',
    });
  });

  it('parses filters from query-string text', () => {
    expect(
      transactionListQuerySchema.parse({
        page: '3',
        pageSize: '50',
        q: '  fresh ',
        type: 'expense',
        tags: 'Work,family',
        from: '2026-10-01',
        to: '2026-10-31',
        minAmount: '10.5',
        maxAmount: '500',
        sort: 'largest',
      }),
    ).toEqual({
      page: 3,
      pageSize: 50,
      q: 'fresh',
      type: 'expense',
      tags: ['work', 'family'],
      from: '2026-10-01',
      to: '2026-10-31',
      minAmount: '10.5',
      maxAmount: '500',
      sort: 'largest',
      status: 'active',
    });
  });

  it('bounds paging and only allows known sort orders', () => {
    for (const query of [
      { pageSize: '101' },
      { pageSize: '0' },
      { page: '-1' },
      { page: '1.5' },
      { sort: 'amount_minor' },
      { sort: 'occurred_at; DROP TABLE transactions' },
    ]) {
      expect(transactionListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('rejects unknown parameters, invalid dates, and inverted ranges', () => {
    expect(transactionListQuerySchema.safeParse({ acount: ACCOUNT_ID }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(
      paths(transactionFilterQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' })),
    ).toEqual(['to']);
    expect(
      paths(transactionFilterQuerySchema.safeParse({ minAmount: '500', maxAmount: '99.99' })),
    ).toEqual(['maxAmount']);
    expect(transactionFilterQuerySchema.safeParse({ minAmount: '-5' }).success).toBe(false);
    expect(transactionFilterQuerySchema.safeParse({ minAmount: '1.2345' }).success).toBe(false);
  });
});

describe('category inputs', () => {
  it('trims names and only allows a rename on update', () => {
    expect(createCategoryInputSchema.parse({ name: ' Pets ', kind: 'expense' })).toEqual({
      name: 'Pets',
      kind: 'expense',
    });
    expect(createCategoryInputSchema.safeParse({ name: 'Pets', kind: 'transfer' }).success).toBe(
      false,
    );
    expect(updateCategoryInputSchema.safeParse({ name: 'Pets', kind: 'income' }).success).toBe(
      false,
    );
    expect(updateCategoryInputSchema.safeParse({ name: 'x'.repeat(51) }).success).toBe(false);
  });
});
