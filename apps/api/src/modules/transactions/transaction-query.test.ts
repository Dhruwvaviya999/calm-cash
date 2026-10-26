import { describe, expect, it } from 'vitest';

import { escapeLikePattern, transactionOrderBy, transactionWhere } from './transaction-query';

const USER = '0193a000-0000-7000-8000-000000000001';

describe('escapeLikePattern', () => {
  it('makes LIKE wildcards literal', () => {
    expect(escapeLikePattern('50% off_now\\')).toBe('50\\% off\\_now\\\\');
    expect(escapeLikePattern('FreshMart')).toBe('FreshMart');
  });
});

describe('transactionWhere', () => {
  it('always scopes by owner and excludes voided rows by default', () => {
    expect(transactionWhere(USER, { status: 'active' }, 'UTC')).toEqual({
      userId: USER,
      AND: [{ voidedAt: null }],
    });
    expect(transactionWhere(USER, { status: 'all' }, 'UTC')).toEqual({ userId: USER, AND: [] });
  });

  it('turns calendar dates into the user’s local day boundaries', () => {
    const where = transactionWhere(
      USER,
      { status: 'all', from: '2026-10-01', to: '2026-10-31' },
      'Asia/Kolkata',
    );
    expect(where.AND).toEqual([
      { occurredAt: { gte: new Date('2026-09-30T18:30:00.000Z') } },
      { occurredAt: { lt: new Date('2026-10-31T18:30:00.000Z') } },
    ]);
  });

  it('converts amount bounds per currency', () => {
    const where = transactionWhere(USER, { status: 'all', minAmount: '10.5' }, 'UTC');
    const [amounts] = Array.isArray(where.AND) ? where.AND : [];
    expect(amounts?.OR).toEqual(
      expect.arrayContaining([
        { currency: 'INR', amountMinor: { gte: 1_050n } },
        { currency: 'JPY', amountMinor: { gte: 11n } },
        { currency: 'KWD', amountMinor: { gte: 10_500n } },
      ]),
    );
  });
});

describe('transactionOrderBy', () => {
  it('always ends with the ID as a tie-breaker', () => {
    for (const sort of ['newest', 'oldest', 'largest', 'smallest'] as const) {
      expect(Object.keys(transactionOrderBy(sort).at(-1) ?? {})).toEqual(['id']);
    }
  });
});
