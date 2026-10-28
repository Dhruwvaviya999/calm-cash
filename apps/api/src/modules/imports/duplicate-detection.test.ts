import type { ImportTransactionRefDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  detectDuplicates,
  movesMoney,
  type LedgerTransaction,
  type StagedRowFacts,
} from './duplicate-detection';

const ACCOUNT = '0193a000-0000-7000-8000-000000000201';
const OTHER = '0193a000-0000-7000-8000-000000000202';

function row(id: string, overrides: Partial<StagedRowFacts> = {}): StagedRowFacts {
  return {
    id,
    rowNumber: Number(id.slice(-2)),
    date: '2026-10-05',
    amountMinor: 45_000n,
    direction: 'debit',
    key: 'upi swiggy',
    ...overrides,
  };
}

function ref(id: string): ImportTransactionRefDto {
  return {
    id,
    type: 'expense',
    amountMinor: '45000',
    currency: 'INR',
    occurredAt: '2026-10-05T06:30:00.000Z',
    description: 'Swiggy',
    status: 'active',
  };
}

function ledger(id: string, overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id,
    type: 'expense',
    accountId: ACCOUNT,
    transferAccountId: null,
    adjustmentDirection: null,
    amountMinor: 45_000n,
    currency: 'INR',
    localDate: '2026-10-06',
    ref: ref(id),
    key: 'swiggy dinner',
    ...overrides,
  };
}

const none = new Set<string>();

describe('detectDuplicates', () => {
  it('flags repeated rows within a statement for review, both ways, never dropping them', () => {
    const found = detectDuplicates({
      accountId: ACCOUNT,
      rows: [row('r01'), row('r02'), row('r03', { amountMinor: 1n })],
      priorImports: [],
      ledger: [],
      linkedTransactionIds: none,
    });
    expect(found.get('r01')).toEqual([
      { reason: 'same_details', row: { id: 'r02', rowNumber: 2 } },
    ]);
    expect(found.get('r02')).toEqual([
      { reason: 'same_details', row: { id: 'r01', rowNumber: 1 } },
    ]);
    expect(found.has('r03')).toBe(false);
  });

  it('treats a shared bank reference as strong evidence and different references as different', () => {
    const found = detectDuplicates({
      accountId: ACCOUNT,
      rows: [
        row('r01', { reference: 'UTR 123' }),
        row('r02', { reference: 'utr123', date: '2026-10-07' }),
        row('r03', { reference: 'UTR999' }),
      ],
      priorImports: [],
      ledger: [],
      linkedTransactionIds: none,
    });
    expect(found.get('r01')?.[0]).toMatchObject({ reason: 'same_reference', row: { id: 'r02' } });
    // Same details as r01 but a different reference: two genuine payments.
    expect(found.has('r03')).toBe(false);
  });

  it('recognises rows imported from an earlier statement', () => {
    const found = detectDuplicates({
      accountId: ACCOUNT,
      rows: [row('r01')],
      priorImports: [
        {
          batchId: 'b1',
          fileName: 'sept.csv',
          date: '2026-10-05',
          amountMinor: 45_000n,
          direction: 'debit',
          key: 'upi swiggy',
          transaction: ref('t-prior'),
        },
      ],
      ledger: [ledger('t-prior')],
      linkedTransactionIds: none,
    });
    expect(found.get('r01')).toEqual([
      {
        reason: 'previously_imported',
        transaction: ref('t-prior'),
        importedFrom: { batchId: 'b1', fileName: 'sept.csv' },
        dateDifferenceDays: 0,
      },
    ]);
  });

  it('suggests ledger transactions only with the same amount and direction within three days', () => {
    const found = detectDuplicates({
      accountId: ACCOUNT,
      rows: [row('r01')],
      priorImports: [],
      ledger: [
        ledger('t-near'),
        ledger('t-far', { localDate: '2026-10-10' }),
        ledger('t-amount', { amountMinor: 45_001n }),
        ledger('t-income', { type: 'income' }),
        ledger('t-linked'),
        ledger('t-exact', { localDate: '2026-10-05' }),
      ],
      linkedTransactionIds: new Set(['t-linked']),
    });
    expect(found.get('r01')?.map((candidate) => candidate.transaction?.id)).toEqual([
      't-exact',
      't-near',
    ]);
  });

  it('knows which transactions move money in which direction', () => {
    const transfer = ledger('t', {
      type: 'transfer',
      accountId: OTHER,
      transferAccountId: ACCOUNT,
    });
    expect(movesMoney(transfer, ACCOUNT, 'credit')).toBe(true);
    expect(movesMoney(transfer, ACCOUNT, 'debit')).toBe(false);
    expect(
      movesMoney(
        ledger('a', { type: 'balance_adjustment', adjustmentDirection: 'decrease' }),
        ACCOUNT,
        'debit',
      ),
    ).toBe(true);
  });
});
