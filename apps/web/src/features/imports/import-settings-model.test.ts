import type { ImportBatchDetailDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  buildSettingsInput,
  initialMappingValues,
  type MappingFormValues,
} from './import-settings-model';

const AT = '2026-10-28T06:00:00.000Z';

function batch(overrides: Partial<ImportBatchDetailDto> = {}): ImportBatchDetailDto {
  return {
    id: '0193a000-0000-7000-8000-000000000901',
    userId: '0193a000-0000-7000-8000-000000000001',
    account: {
      id: '0193a000-0000-7000-8000-000000000201',
      name: 'HDFC Salary',
      type: 'bank',
      currency: 'INR',
      status: 'active',
    },
    fileName: 'october.csv',
    format: 'csv',
    delimiter: ',',
    hasHeaderRow: true,
    currency: 'INR',
    status: 'mapping',
    columns: ['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Amount'],
    statement: {},
    totalRows: 3,
    counts: { invalid: 0, review: 0, ready: 0, matched: 0, imported: 0, skipped: 0, failed: 0 },
    createdAt: AT,
    updatedAt: AT,
    sampleRows: [],
    proposed: {
      mapping: { date: 0, description: 1, reference: 2, amountColumn: 5 },
      dateFormats: ['DD/MM/YYYY', 'MM/DD/YYYY'],
      decimalSeparator: '.',
    },
    ...overrides,
  };
}

const OPTIONS = { columnCount: 6, currency: 'INR', accountType: 'bank' } as const;

function valid(overrides: Partial<MappingFormValues> = {}): MappingFormValues {
  return {
    ...initialMappingValues(batch()),
    convention: 'negative_is_debit',
    dateFormat: 'DD/MM/YYYY',
    ...overrides,
  };
}

describe('initialMappingValues', () => {
  it('takes the proposed columns but never guesses a date layout or sign convention', () => {
    const values = initialMappingValues(batch());
    expect(values).toMatchObject({
      date: '0',
      description: '1',
      reference: '2',
      counterparty: '',
      amountMode: 'signed',
      amount: '5',
      convention: '',
      dateFormat: '',
    });
  });

  it('preselects the date layout when exactly one fits, and proposes split columns', () => {
    const values = initialMappingValues(
      batch({
        proposed: {
          mapping: { date: 0, description: 1, debitColumn: 3, creditColumn: 4 },
          dateFormats: ['YYYY-MM-DD'],
        },
      }),
    );
    expect(values).toMatchObject({
      amountMode: 'split',
      debit: '3',
      credit: '4',
      dateFormat: 'YYYY-MM-DD',
    });
  });

  it('shows saved statement balances of a card as the amount owed', () => {
    const values = initialMappingValues(
      batch({
        account: { ...batch().account, type: 'credit_card' },
        statement: { periodEnd: '2026-10-31', closingBalanceMinor: '-1250050' },
      }),
    );
    expect(values.closingBalance).toBe('12500.50');
    expect(values.periodEnd).toBe('2026-10-31');
  });
});

describe('buildSettingsInput', () => {
  it('builds the exact settings contract', () => {
    const result = buildSettingsInput(
      valid({ periodStart: '2026-10-01', periodEnd: '2026-10-31', closingBalance: '-2,500.25' }),
      OPTIONS,
    );
    expect(result).toEqual({
      ok: true,
      input: {
        settings: {
          dateFormat: 'DD/MM/YYYY',
          decimalSeparator: '.',
          mapping: {
            date: 0,
            description: 1,
            amount: { mode: 'signed', column: 5, convention: 'negative_is_debit' },
            reference: 2,
          },
        },
        statement: {
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          closingBalanceMinor: '-250025',
        },
      },
    });
  });

  it('requires the person to choose the sign convention and the date layout', () => {
    const result = buildSettingsInput(valid({ convention: '', dateFormat: '' }), OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.convention).toMatch(/negative amount/);
      expect(result.errors.dateFormat).toMatch(/dates are written/);
    }
  });

  it('refuses one column used for two kinds of value', () => {
    const result = buildSettingsInput(
      valid({ amountMode: 'split', debit: '3', credit: '3' }),
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.credit).toMatch(/already used for the money out/);
  });

  it('refuses columns the file does not have and balances without their date', () => {
    const result = buildSettingsInput(valid({ amount: '9', openingBalance: '100' }), OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toMatch(/column of this statement/);
      expect(result.errors.periodStart).toMatch(/first day/);
    }
  });

  it('stores an amount owed on a card as a negative balance', () => {
    const result = buildSettingsInput(valid({ periodEnd: '2026-10-31', closingBalance: '800' }), {
      ...OPTIONS,
      accountType: 'credit_card',
    });
    expect(result.ok && result.input.statement?.closingBalanceMinor).toBe('-80000');
  });

  it('refuses a period that ends before it starts and amounts with too many decimals', () => {
    const result = buildSettingsInput(
      valid({ periodStart: '2026-10-31', periodEnd: '2026-10-01', closingBalance: '1.234' }),
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.periodEnd).toMatch(/end on or after/);
      expect(result.errors.closingBalance).toMatch(/decimal places/);
    }
  });
});
