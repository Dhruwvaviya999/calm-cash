import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_TYPE_CLASSIFICATION,
  CREATABLE_ACCOUNT_TYPES,
  getAccountClassification,
} from '../constants/accounts';
import { ACCOUNT_TYPES } from '../constants/domain';
import { MAX_ENTERED_AMOUNT_MINOR, MINOR_UNITS_MAX } from '../constants/money';
import type { AccountDto } from '../types/account';
import {
  accountDtoSchema,
  accountListQuerySchema,
  accountRuleViolations,
  createAccountInputSchema,
  updateAccountInputSchema,
} from './account';

const TIMESTAMP = '2026-10-25T09:30:00.000Z';

const validInput = {
  name: 'HDFC Savings',
  type: 'savings',
  currency: 'INR',
  openingBalanceMinor: '1250050',
} as const;

const account: AccountDto = {
  id: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70',
  userId: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e6f',
  name: 'Rewards Card',
  type: 'credit_card',
  classification: 'liability',
  currency: 'INR',
  openingBalanceMinor: '-1250000',
  openingBalanceDate: '2026-10-01',
  creditLimitMinor: '10000000',
  status: 'active',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

function paths(result: { error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

describe('account types and classification', () => {
  it('offers exactly the supported account types for new accounts', () => {
    expect(CREATABLE_ACCOUNT_TYPES).toEqual([
      'cash',
      'bank',
      'savings',
      'digital_wallet',
      'credit_card',
      'other',
    ]);
  });

  it('classifies every stored type, with credit cards and loans as liabilities', () => {
    for (const type of ACCOUNT_TYPES) {
      expect(ACCOUNT_TYPE_CLASSIFICATION[type]).toBeDefined();
    }
    expect(getAccountClassification('credit_card')).toBe('liability');
    expect(getAccountClassification('loan')).toBe('liability');
    expect(getAccountClassification('savings')).toBe('asset');
  });

  it('rejects unknown and non-creatable account types', () => {
    expect(createAccountInputSchema.safeParse({ ...validInput, type: 'crypto' }).success).toBe(
      false,
    );
    expect(createAccountInputSchema.safeParse({ ...validInput, type: 'loan' }).success).toBe(false);
    expect(createAccountInputSchema.safeParse({ ...validInput, type: 'investment' }).success).toBe(
      false,
    );
  });
});

describe('createAccountInputSchema', () => {
  it('accepts a minimal account and trims text', () => {
    expect(createAccountInputSchema.parse({ ...validInput, name: '  HDFC Savings ' })).toEqual(
      validInput,
    );
  });

  it('requires an explicit opening balance, so zero is never assumed', () => {
    const { openingBalanceMinor: _omitted, ...withoutBalance } = validInput;
    expect(paths(createAccountInputSchema.safeParse(withoutBalance))).toEqual([
      'openingBalanceMinor',
    ]);
    expect(
      createAccountInputSchema.safeParse({ ...validInput, openingBalanceMinor: '0' }).success,
    ).toBe(true);
  });

  it('accepts only canonical minor-unit strings within the enterable range', () => {
    for (const value of ['12.50', '1e3', '007', 1250, '-0']) {
      expect(
        createAccountInputSchema.safeParse({ ...validInput, openingBalanceMinor: value }).success,
      ).toBe(false);
    }
    expect(
      createAccountInputSchema.safeParse({
        ...validInput,
        openingBalanceMinor: MAX_ENTERED_AMOUNT_MINOR.toString(),
      }).success,
    ).toBe(true);
    expect(
      createAccountInputSchema.safeParse({
        ...validInput,
        openingBalanceMinor: (MAX_ENTERED_AMOUNT_MINOR + 1n).toString(),
      }).success,
    ).toBe(false);
    expect(
      createAccountInputSchema.safeParse({
        ...validInput,
        openingBalanceMinor: MINOR_UNITS_MAX.toString(),
      }).success,
    ).toBe(false);
  });

  it('only accepts supported currencies', () => {
    expect(createAccountInputSchema.safeParse({ ...validInput, currency: 'XYZ' }).success).toBe(
      false,
    );
    expect(createAccountInputSchema.safeParse({ ...validInput, currency: 'inr' }).success).toBe(
      false,
    );
  });

  it('refuses negative balances for cash, savings, and wallets but allows bank overdrafts', () => {
    for (const type of ['cash', 'savings', 'digital_wallet'] as const) {
      expect(
        paths(
          createAccountInputSchema.safeParse({ ...validInput, type, openingBalanceMinor: '-1' }),
        ),
      ).toEqual(['openingBalanceMinor']);
    }
    expect(
      createAccountInputSchema.safeParse({
        ...validInput,
        type: 'bank',
        openingBalanceMinor: '-500',
      }).success,
    ).toBe(true);
  });

  it('accepts a credit limit only for credit cards, and only when positive', () => {
    const card = { ...validInput, type: 'credit_card', openingBalanceMinor: '-1250000' } as const;
    expect(
      createAccountInputSchema.safeParse({ ...card, creditLimitMinor: '10000000' }).success,
    ).toBe(true);
    for (const limit of ['0', '-100', '12.5']) {
      expect(
        paths(createAccountInputSchema.safeParse({ ...card, creditLimitMinor: limit })),
      ).toEqual(['creditLimitMinor']);
    }
    expect(
      paths(createAccountInputSchema.safeParse({ ...validInput, creditLimitMinor: '10000000' })),
    ).toEqual(['creditLimitMinor']);
  });

  it('validates the opening-balance date', () => {
    expect(
      createAccountInputSchema.safeParse({ ...validInput, openingBalanceDate: '2026-02-30' })
        .success,
    ).toBe(false);
    expect(
      createAccountInputSchema.safeParse({ ...validInput, openingBalanceDate: '1899-12-31' })
        .success,
    ).toBe(false);
    expect(
      createAccountInputSchema.safeParse({ ...validInput, openingBalanceDate: '2026-10-01' })
        .success,
    ).toBe(true);
  });

  it('rejects owner identifiers and other privileged fields', () => {
    for (const extra of [
      { userId: account.userId },
      { id: account.id },
      { status: 'archived' },
      { archivedAt: TIMESTAMP },
      { classification: 'liability' },
    ]) {
      expect(createAccountInputSchema.safeParse({ ...validInput, ...extra }).success).toBe(false);
    }
  });
});

describe('updateAccountInputSchema', () => {
  it('accepts partial updates and null to clear optional fields', () => {
    expect(updateAccountInputSchema.parse({ institution: null, color: 'blue' })).toEqual({
      institution: null,
      color: 'blue',
    });
  });

  it('rejects empty updates and privileged fields', () => {
    expect(updateAccountInputSchema.safeParse({}).success).toBe(false);
    expect(updateAccountInputSchema.safeParse({ userId: account.userId }).success).toBe(false);
    expect(updateAccountInputSchema.safeParse({ createdAt: TIMESTAMP }).success).toBe(false);
  });
});

describe('accountRuleViolations', () => {
  it('checks the merged state of an update', () => {
    expect(
      accountRuleViolations({ type: 'cash', openingBalanceMinor: '-100', creditLimitMinor: '500' }),
    ).toEqual([
      {
        path: 'openingBalanceMinor',
        message: 'This type of account cannot have a negative balance.',
      },
      { path: 'creditLimitMinor', message: 'Only credit cards have a credit limit.' },
    ]);
    expect(accountRuleViolations({ type: 'credit_card', openingBalanceMinor: '-100' })).toEqual([]);
  });
});

describe('accountListQuerySchema', () => {
  it('defaults to active accounts and validates filters', () => {
    expect(accountListQuerySchema.parse({})).toEqual({ status: 'active' });
    expect(accountListQuerySchema.parse({ status: 'all', type: 'savings' })).toEqual({
      status: 'all',
      type: 'savings',
    });
    expect(accountListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('accountDtoSchema', () => {
  it('accepts a consistent account', () => {
    expect(accountDtoSchema.safeParse(account).success).toBe(true);
  });

  it('rejects a classification that contradicts the type', () => {
    expect(paths(accountDtoSchema.safeParse({ ...account, classification: 'asset' }))).toEqual([
      'classification',
    ]);
  });

  it('requires archive times exactly for archived accounts', () => {
    expect(accountDtoSchema.safeParse({ ...account, status: 'archived' }).success).toBe(false);
    expect(
      accountDtoSchema.safeParse({ ...account, status: 'archived', archivedAt: TIMESTAMP }).success,
    ).toBe(true);
    expect(accountDtoSchema.safeParse({ ...account, archivedAt: TIMESTAMP }).success).toBe(false);
  });

  it('keeps large amounts exact as strings', () => {
    const parsed = accountDtoSchema.parse({ ...account, openingBalanceMinor: '-999999999999999' });
    expect(parsed.openingBalanceMinor).toBe('-999999999999999');
  });
});
