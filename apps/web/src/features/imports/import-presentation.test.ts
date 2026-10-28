import type { ImportRowDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { describeBalance, describeDifference, describeProposal } from './import-presentation';

const base = {
  id: '0193a000-0000-7000-8000-000000000601',
  batchId: '0193a000-0000-7000-8000-000000000901',
  rowNumber: 3,
  date: '2026-10-03',
  amountMinor: '125000',
  direction: 'debit',
  description: 'UPI/BIGBASKET',
  warnings: [],
  duplicates: [],
  duplicateDismissed: false,
  proposal: {
    type: 'expense',
    description: 'UPI/BIGBASKET',
    tags: [],
    occurredAt: '2026-10-03T06:30:00.000Z',
    suggested: false,
  },
} as const satisfies Omit<ImportRowDto, 'status'>;

describe('describeProposal', () => {
  it('never suggests that a matched or skipped row records anything', () => {
    const matched: ImportRowDto = { ...base, status: 'matched', transactionId: base.id };
    const skipped: ImportRowDto = { ...base, status: 'skipped' };
    expect(describeProposal(matched, [], [])).toBe('Nothing new (linked to your transaction)');
    expect(describeProposal(skipped, [], [])).toBe('Nothing (skipped)');
  });

  it('asks for what is still missing before a row can be imported', () => {
    const ready: ImportRowDto = { ...base, status: 'ready' };
    const transfer: ImportRowDto = {
      ...base,
      status: 'ready',
      proposal: { ...base.proposal, type: 'transfer' },
    };
    expect(describeProposal(ready, [], [])).toBe('Expense · choose a category');
    expect(describeProposal(transfer, [], [])).toBe('Transfer to (choose the account)');
  });
});

describe('balances of cards and loans', () => {
  it('reads as the amount owed, and differences in those terms', () => {
    expect(describeBalance('-1250050', 'INR', 'credit_card')).toBe('₹12,500.50 owed');
    expect(describeBalance('20000', 'INR', 'credit_card')).toBe('₹200.00 in credit');
    expect(describeDifference('-20000', 'INR', 'credit_card')).toBe(
      'The statement shows ₹200.00 more owed than your ledger.',
    );
    expect(describeDifference('20000', 'INR', 'bank')).toBe(
      'The statement shows ₹200.00 more than your ledger.',
    );
    expect(describeDifference('0', 'INR', 'bank')).toBe('They match.');
  });
});
