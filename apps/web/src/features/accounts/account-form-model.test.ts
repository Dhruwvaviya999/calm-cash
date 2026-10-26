import type { AccountDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  accountToFormValues,
  buildCreateAccountInput,
  buildUpdateAccountInput,
  editableAccountTypes,
  emptyAccountFormValues,
  formErrorsFromPaths,
  getAccountTypeFormCopy,
  type AccountFormValues,
} from './account-form-model';

const base: AccountFormValues = {
  ...emptyAccountFormValues('INR', 'Asia/Kolkata'),
  name: 'HDFC Salary',
  type: 'bank',
  openingBalance: '12,500.50',
  openingBalanceDate: '2026-10-01',
};

const card: AccountDto = {
  id: '0193a000-0000-7000-8000-000000000202',
  userId: '0193a000-0000-7000-8000-000000000001',
  name: 'Rewards Card',
  type: 'credit_card',
  classification: 'liability',
  currency: 'INR',
  openingBalanceMinor: '-1250000',
  openingBalanceDate: '2026-10-01',
  institution: 'Axis Bank',
  creditLimitMinor: '10000000',
  status: 'active',
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-10-01T04:30:00.000Z',
};

describe('buildCreateAccountInput', () => {
  it('converts typed amounts into exact minor units', () => {
    expect(buildCreateAccountInput({ ...base, institution: ' HDFC Bank ' })).toEqual({
      ok: true,
      input: {
        name: 'HDFC Salary',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '1250050',
        openingBalanceDate: '2026-10-01',
        institution: 'HDFC Bank',
      },
    });
  });

  it('stores what a credit card owes as a negative net position', () => {
    const result = buildCreateAccountInput({
      ...base,
      type: 'credit_card',
      openingBalance: '12500',
      creditLimit: '1,00,000',
    });
    expect(result.ok && result.input).toMatchObject({
      openingBalanceMinor: '-1250000',
      creditLimitMinor: '10000000',
    });
  });

  it('keeps zero distinct from a missing balance', () => {
    expect(buildCreateAccountInput({ ...base, openingBalance: '0' }).ok).toBe(true);
    expect(buildCreateAccountInput({ ...base, openingBalance: '' })).toEqual({
      ok: false,
      errors: { openingBalance: 'Enter an amount (0 is fine).' },
    });
  });

  it('rejects more decimals than the currency allows instead of rounding', () => {
    expect(buildCreateAccountInput({ ...base, openingBalance: '10.005' })).toEqual({
      ok: false,
      errors: { openingBalance: 'INR amounts have at most 2 decimal places.' },
    });
    expect(buildCreateAccountInput({ ...base, currency: 'JPY', openingBalance: '10.5' })).toEqual({
      ok: false,
      errors: { openingBalance: 'JPY amounts have no decimal places.' },
    });
  });

  it('allows overdrafts on bank accounts but never negative cash', () => {
    expect(buildCreateAccountInput({ ...base, openingBalance: '-2500' }).ok).toBe(true);
    expect(buildCreateAccountInput({ ...base, type: 'cash', openingBalance: '-2500' })).toEqual({
      ok: false,
      errors: { openingBalance: 'This type of account cannot have a negative balance.' },
    });
  });

  it('ignores fields the chosen type does not use', () => {
    const result = buildCreateAccountInput({
      ...base,
      type: 'cash',
      institution: 'Should be ignored',
      creditLimit: '5000',
    });
    expect(result.ok && result.input).not.toHaveProperty('institution');
    expect(result.ok && result.input).not.toHaveProperty('creditLimitMinor');
  });

  it('requires a type and validates the name with the shared schema', () => {
    expect(buildCreateAccountInput({ ...base, type: '' })).toEqual({
      ok: false,
      errors: { type: 'Choose an account type.' },
    });
    expect(buildCreateAccountInput({ ...base, name: '  ' })).toEqual({
      ok: false,
      errors: { name: 'Enter a name for this account.' },
    });
  });

  it('rejects a zero credit limit', () => {
    expect(
      buildCreateAccountInput({
        ...base,
        type: 'credit_card',
        openingBalance: '0',
        creditLimit: '0',
      }),
    ).toEqual({
      ok: false,
      errors: { creditLimit: 'Enter a credit limit above zero, or leave it empty.' },
    });
  });
});

describe('editing', () => {
  it('shows an existing card as the amount owed', () => {
    expect(accountToFormValues(card)).toMatchObject({
      type: 'credit_card',
      openingBalance: '12500.00',
      creditLimit: '100000.00',
      institution: 'Axis Bank',
    });
  });

  it('sends only what changed, and null to clear', () => {
    const values = { ...accountToFormValues(card), name: 'Travel Card', institution: '' };
    expect(buildUpdateAccountInput(card, values)).toEqual({
      ok: true,
      input: { name: 'Travel Card', institution: null },
    });
  });

  it('sends nothing when nothing changed', () => {
    expect(buildUpdateAccountInput(card, accountToFormValues(card))).toEqual({
      ok: true,
      input: undefined,
    });
  });

  it('only offers types of the same classification', () => {
    expect(editableAccountTypes('credit_card')).toEqual(['credit_card']);
    expect(editableAccountTypes('bank')).toEqual([
      'cash',
      'bank',
      'savings',
      'digital_wallet',
      'other',
    ]);
  });
});

describe('type-specific copy', () => {
  it('asks credit cards for the amount owed and shows the limit field', () => {
    expect(getAccountTypeFormCopy('credit_card')).toMatchObject({
      balanceLabel: 'Amount you owe now',
      enterAsAmountOwed: true,
      showCreditLimit: true,
    });
    expect(getAccountTypeFormCopy('cash')).toMatchObject({
      institutionLabel: undefined,
      showCreditLimit: false,
      allowNegative: false,
    });
  });
});

describe('formErrorsFromPaths', () => {
  it('maps API paths onto form fields', () => {
    expect(
      formErrorsFromPaths([
        { path: 'body.openingBalanceMinor', message: 'Locked.' },
        { path: 'body.creditLimitMinor', message: 'Too high.' },
        { path: 'body.name', message: 'Too long.' },
        { path: 'body.unknown', message: 'Ignored.' },
      ]),
    ).toEqual({ openingBalance: 'Locked.', creditLimit: 'Too high.', name: 'Too long.' });
  });
});
