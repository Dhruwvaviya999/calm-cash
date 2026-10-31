import type { CategorySpendDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import type { ActivityRow } from './insights.repository';
import { descriptionKey, payeeKey } from './merchant-key';
import {
  categoryChanges,
  changeBp,
  frequentPayees,
  median,
  percentile,
  recurringCandidates,
  unusualExpenses,
  type RecurringCandidate,
} from './patterns';

let counter = 0;

function row(overrides: Partial<ActivityRow> & { occurredAt: Date }): ActivityRow {
  counter += 1;
  return {
    id: `row-${counter.toString()}`,
    type: 'expense',
    amountMinor: 10_000n,
    currency: 'INR',
    description: 'Payment',
    merchant: null,
    categoryId: 'food',
    categoryName: 'Food',
    topCategoryName: 'Food',
    accountId: 'bank',
    paymentMethod: null,
    ...overrides,
  };
}

const at = (date: string): Date => new Date(`${date}T06:00:00.000Z`);

function spend(
  categoryId: string,
  amountMinor: string,
  transactionCount: number,
): CategorySpendDto {
  return {
    kind: 'category',
    categoryId,
    name: categoryId,
    archived: false,
    amountMinor,
    transactionCount,
    shareBasisPoints: '0',
  };
}

describe('grouping keys', () => {
  it('drops reference numbers and punctuation from bank descriptions', () => {
    expect(descriptionKey('UPI/SWIGGY/412345678/Order 9921')).toBe('upi swiggy order');
    expect(payeeKey('Netflix.com', 'NETFLIX SUBSCRIPTION 0921')).toBe('netflix com');
    expect(payeeKey(null, 'NETFLIX SUBSCRIPTION 0921')).toBe('netflix subscription');
    expect(payeeKey('  ', 'Rent October')).toBe('rent october');
  });
});

describe('statistics', () => {
  it('computes medians, percentiles, and changes in basis points', () => {
    expect(median([5n, 1n, 3n])).toBe(3n);
    expect(median([1n, 2n, 3n, 4n])).toBe(2n);
    expect(median([])).toBe(0n);
    expect(percentile([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n], 0.9)).toBe(9n);
    expect(changeBp(1_000n, 1_250n)).toBe(2_500n);
    expect(changeBp(1_000n, 500n)).toBe(-5_000n);
    expect(changeBp(0n, 500n)).toBeUndefined();
  });
});

describe('categoryChanges', () => {
  it('reports clear, material changes between periods only', () => {
    const result = categoryChanges(
      [
        spend('food', '600000', 6), // +50% and a large share
        spend('fuel', '110000', 3), // +10%: too small a change
        spend('books', '30000', 2), // +200% but under 5% of spending
        spend('travel', '100000', 1), // too few payments
        spend('rent', '100000', 2), // -50%
      ],
      [
        spend('food', '400000', 5),
        spend('fuel', '100000', 3),
        spend('books', '10000', 2),
        spend('travel', '10000', 4),
        spend('rent', '200000', 2),
      ],
      { current: 940_000n, previous: 720_000n },
    );

    expect(result.increases.map((change) => [change.categoryId, change.changeBp])).toEqual([
      ['food', 5_000n],
    ]);
    expect(result.decreases.map((change) => [change.categoryId, change.changeBp])).toEqual([
      ['rent', -5_000n],
    ]);
  });
});

describe('unusualExpenses', () => {
  const history = Array.from({ length: 10 }, (_, index) =>
    row({ amountMinor: BigInt(40_000 + index * 2_000), occurredAt: at('2026-05-01') }),
  );

  it('flags an expense far above the category’s usual amounts', () => {
    const big = row({ amountMinor: 250_000n, occurredAt: at('2026-10-10') });
    const normal = row({ amountMinor: 50_000n, occurredAt: at('2026-10-11') });

    const found = unusualExpenses([big, normal], history);

    expect(found).toHaveLength(1);
    expect(found[0]?.row.id).toBe(big.id);
    expect(found[0]?.medianMinor).toBe(49_000n);
  });

  it('needs enough history in the same category and currency', () => {
    const big = row({ amountMinor: 250_000n, occurredAt: at('2026-10-10') });

    expect(unusualExpenses([big], history.slice(0, 7))).toEqual([]);
    expect(unusualExpenses([{ ...big, currency: 'USD' }], history)).toEqual([]);
    expect(unusualExpenses([{ ...big, categoryId: 'travel' }], history)).toEqual([]);
  });
});

describe('frequentPayees', () => {
  it('groups by payee and needs at least five payments', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, day) =>
        row({ merchant: 'Swiggy', occurredAt: at(`2026-10-0${(day + 1).toString()}`) }),
      ),
      ...Array.from({ length: 4 }, (_, day) =>
        row({ merchant: 'Uber', occurredAt: at(`2026-10-0${(day + 1).toString()}`) }),
      ),
    ];

    expect(frequentPayees(rows).map((payee) => [payee.label, payee.count])).toEqual([
      ['Swiggy', 5],
    ]);
  });
});

describe('recurringCandidates', () => {
  const today = '2026-10-29';
  const monthly = (merchant: string, amounts: bigint[], startMonth = 6): ActivityRow[] =>
    amounts.map((amountMinor, index) =>
      row({
        merchant,
        amountMinor,
        occurredAt: at(`2026-${(startMonth + index).toString().padStart(2, '0')}-05`),
      }),
    );

  it('finds a steady monthly payment and estimates the next date', () => {
    const rows = monthly('Netflix', [64_900n, 64_900n, 64_900n, 64_900n, 64_900n]);

    const [candidate] = recurringCandidates(rows, [], new Set(), today, 'Asia/Kolkata');

    expect(candidate).toMatchObject({
      key: 'rc:INR:netflix',
      frequency: 'monthly',
      typicalMinor: 64_900n,
      lastDate: '2026-10-05',
      nextEstimatedDate: '2026-11-05',
      strong: true,
    });
  });

  it('accepts some variation in amount as a possible candidate', () => {
    const rows = monthly('Airtel', [59_900n, 64_900n, 62_000n], 8);

    const [candidate] = recurringCandidates(rows, [], new Set(), today, 'Asia/Kolkata');

    expect(candidate).toMatchObject({ frequency: 'monthly', strong: false });
  });

  it('ignores irregular, varying, stale, too-short, covered, and dismissed patterns', () => {
    const none = (
      rows: ActivityRow[],
      options: { covered?: boolean; dismissed?: string } = {},
    ): RecurringCandidate[] =>
      recurringCandidates(
        rows,
        options.covered === true ? [{ name: 'Netflix', merchant: 'Netflix', currency: 'INR' }] : [],
        new Set(options.dismissed === undefined ? [] : [options.dismissed]),
        today,
        'Asia/Kolkata',
      );

    expect(none(monthly('Netflix', [64_900n, 64_900n]))).toEqual([]);
    expect(none(monthly('Netflix', [64_900n, 99_000n, 64_900n, 64_900n], 7))).toEqual([]);
    expect(none(monthly('Netflix', [64_900n, 64_900n, 64_900n], 3))).toEqual([]); // last in May
    expect(
      none([
        row({ merchant: 'Netflix', occurredAt: at('2026-09-01') }),
        row({ merchant: 'Netflix', occurredAt: at('2026-09-03') }),
        row({ merchant: 'Netflix', occurredAt: at('2026-10-20') }),
      ]),
    ).toEqual([]);
    const steady = monthly('Netflix', [64_900n, 64_900n, 64_900n], 8);
    expect(none(steady)).toHaveLength(1);
    expect(none(steady, { covered: true })).toEqual([]);
    expect(none(steady, { dismissed: 'rc:INR:netflix' })).toEqual([]);
  });

  it('keeps currencies apart', () => {
    const rows = [
      ...monthly('Spotify', [11_900n, 11_900n], 8),
      row({
        merchant: 'Spotify',
        currency: 'USD',
        amountMinor: 999n,
        occurredAt: at('2026-10-05'),
      }),
    ];

    expect(recurringCandidates(rows, [], new Set(), today, 'Asia/Kolkata')).toEqual([]);
  });
});
