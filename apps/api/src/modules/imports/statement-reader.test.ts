import type { ImportSettings } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  descriptionKey,
  looksLikeHeader,
  matchingDateFormats,
  parseStatementAmount,
  parseStatementDate,
  proposeSettings,
  readRow,
} from './statement-reader';

describe('parseStatementDate', () => {
  it('reads each layout exactly and rejects impossible dates', () => {
    expect(parseStatementDate('2026-10-05', 'YYYY-MM-DD')).toEqual({ date: '2026-10-05' });
    expect(parseStatementDate('05/10/2026', 'DD/MM/YYYY')).toEqual({ date: '2026-10-05' });
    expect(parseStatementDate('05/10/2026', 'MM/DD/YYYY')).toEqual({ date: '2026-05-10' });
    expect(parseStatementDate('05-Oct-2026', 'DD-MMM-YYYY')).toEqual({ date: '2026-10-05' });
    expect(parseStatementDate('05 oct 2026', 'DD MMM YYYY')).toEqual({ date: '2026-10-05' });
    expect(parseStatementDate('05/10/26', 'DD/MM/YY')).toEqual({ date: '2026-10-05' });
    expect(parseStatementDate('29/02/2027', 'DD/MM/YYYY')).toBeUndefined();
    expect(parseStatementDate('29/02/2028', 'DD/MM/YYYY')).toEqual({ date: '2028-02-29' });
    expect(parseStatementDate('31/04/2026', 'DD/MM/YYYY')).toBeUndefined();
    expect(parseStatementDate('2026-10-05', 'DD/MM/YYYY')).toBeUndefined();
  });

  it('keeps a time written after the date', () => {
    expect(parseStatementDate('05/10/2026 18:45', 'DD/MM/YYYY')).toEqual({
      date: '2026-10-05',
      time: '18:45',
    });
    expect(parseStatementDate('05/10/2026 25:00', 'DD/MM/YYYY')).toBeUndefined();
  });

  it('lists every layout that fits, so ambiguous dates are never guessed', () => {
    expect(matchingDateFormats(['01/02/2026', '03/04/2026'])).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY']);
    expect(matchingDateFormats(['01/02/2026', '25/04/2026'])).toEqual(['DD/MM/YYYY']);
    expect(matchingDateFormats(['2026-10-05'])).toEqual(['YYYY-MM-DD']);
  });
});

describe('parseStatementAmount', () => {
  it('reads grouping, signs, parentheses, symbols, and Cr/Dr exactly', () => {
    expect(parseStatementAmount('1,23,456.78', '.', 'INR')).toEqual({
      status: 'ok',
      amount: { minorUnits: 12_345_678n, negative: false },
    });
    expect(parseStatementAmount('-₹ 500.00', '.', 'INR')).toMatchObject({
      amount: { minorUnits: 50_000n, negative: true },
    });
    expect(parseStatementAmount('(1,000.50)', '.', 'INR')).toMatchObject({
      amount: { minorUnits: 100_050n, negative: true },
    });
    expect(parseStatementAmount('1.234,56', ',', 'EUR')).toMatchObject({
      amount: { minorUnits: 123_456n },
    });
    expect(parseStatementAmount('2,500.00 Cr', '.', 'INR')).toMatchObject({
      amount: { minorUnits: 250_000n, marker: 'credit' },
    });
    expect(parseStatementAmount('', '.', 'INR')).toEqual({ status: 'blank' });
  });

  it('refuses extra precision, text, and huge values instead of rounding', () => {
    expect(parseStatementAmount('10.005', '.', 'INR').status).toBe('error');
    expect(parseStatementAmount('10.5', '.', 'JPY').status).toBe('error');
    expect(parseStatementAmount('ten', '.', 'INR').status).toBe('error');
    expect(parseStatementAmount('99999999999999999999', '.', 'INR').status).toBe('error');
  });
});

const signed = (convention: 'negative_is_debit' | 'negative_is_credit'): ImportSettings => ({
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: '.',
  mapping: { date: 0, description: 1, amount: { mode: 'signed', column: 2, convention } },
});

const split: ImportSettings = {
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: '.',
  mapping: {
    date: 0,
    description: 1,
    amount: { mode: 'split', debitColumn: 2, creditColumn: 3 },
    reference: 4,
  },
};

describe('readRow', () => {
  it('follows the stated sign convention, never a guess', () => {
    expect(
      readRow(['05/10/2026', 'Coffee', '-120.50'], signed('negative_is_debit'), 'INR'),
    ).toMatchObject({
      date: '2026-10-05',
      amountMinor: 12_050n,
      direction: 'debit',
      problems: [],
    });
    expect(
      readRow(['05/10/2026', 'Refund', '-120.50'], signed('negative_is_credit'), 'INR'),
    ).toMatchObject({
      direction: 'credit',
    });
    expect(
      readRow(['05/10/2026', 'Salary', '2,500.00 Cr'], signed('negative_is_debit'), 'INR'),
    ).toMatchObject({
      direction: 'credit',
      amountMinor: 250_000n,
    });
  });

  it('reads separate debit and credit columns and flags contradictions', () => {
    expect(readRow(['05/10/2026', 'Rent', '25,000.00', '', 'UTR1'], split, 'INR')).toMatchObject({
      direction: 'debit',
      amountMinor: 2_500_000n,
      reference: 'UTR1',
      problems: [],
    });
    expect(readRow(['05/10/2026', 'Salary', '', '95,000.00'], split, 'INR')).toMatchObject({
      direction: 'credit',
    });
    expect(
      readRow(['05/10/2026', 'Both', '10.00', '20.00'], split, 'INR').problems[0]?.message,
    ).toContain('Both');
    expect(readRow(['05/10/2026', 'None', '', ''], split, 'INR').problems[0]?.message).toContain(
      'Neither',
    );
    expect(readRow(['05/10/2026', 'Signed', '-10.00', ''], split, 'INR').problems).toHaveLength(1);
  });

  it('explains invalid dates and amounts in plain words', () => {
    const reading = readRow(['31/02/2026', '', 'abc'], signed('negative_is_debit'), 'INR');
    expect(reading.problems.map((problem) => problem.field)).toEqual([
      'date',
      'amount',
      'description',
    ]);
    expect(reading.amountMinor).toBeUndefined();
  });
});

describe('proposals', () => {
  it('proposes columns from common header names but never a sign convention', () => {
    const proposed = proposeSettings(
      [
        'Txn Date',
        'Narration',
        'Chq./Ref.No.',
        'Withdrawal Amt.',
        'Deposit Amt.',
        'Closing Balance',
      ],
      [['05/10/26', 'UPI/SWIGGY', '123', '450.00', '', '10,000.00']],
    );
    expect(proposed.mapping).toEqual({
      date: 0,
      description: 1,
      reference: 2,
      debitColumn: 3,
      creditColumn: 4,
    });
    expect(proposed.dateFormats).toEqual(['DD/MM/YY', 'MM/DD/YY']);
    expect(proposed.decimalSeparator).toBe('.');
    const single = proposeSettings(
      ['Date', 'Description', 'Amount'],
      [['2026-10-05', 'x', '-1.00']],
    );
    expect(single.mapping).toMatchObject({ amountColumn: 2 });
    expect(single.mapping).not.toHaveProperty('debitColumn');
  });

  it('recognises a header row', () => {
    expect(looksLikeHeader(['Date', 'Description', 'Amount'], ['05/10/2026', 'x', '1.00'])).toBe(
      true,
    );
    expect(looksLikeHeader(['05/10/2026', 'x', '1.00'], ['06/10/2026', 'y', '2.00'])).toBe(false);
  });

  it('normalises descriptions so the same entry reads the same', () => {
    expect(descriptionKey('UPI/1234567/SWIGGY  Bangalore', undefined)).toBe('upi swiggy bangalore');
    expect(descriptionKey('Card 4521 AMAZON', 'Amazon')).toBe('amazon card amazon');
  });
});
