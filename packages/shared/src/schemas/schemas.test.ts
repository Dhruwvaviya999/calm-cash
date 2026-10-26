import { describe, expect, it } from 'vitest';

import type { BudgetDto } from '../types/budget';
import type { TransactionDto } from '../types/transaction';
import { apiErrorResponseSchema, apiSuccessResponseSchema } from './api';
import { budgetDtoSchema } from './budget';
import {
  currencyCodeSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
  timeZoneSchema,
} from './common';
import { healthCheckDtoSchema } from './health';
import { transactionDtoSchema } from './transaction';
import { userDtoSchema } from './user';

const USER_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e6f';
const ACCOUNT_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70';
const OTHER_ACCOUNT_ID = '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e71';
const TIMESTAMP = '2026-10-25T09:30:00.000Z';

const expense = {
  id: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e72',
  userId: USER_ID,
  accountId: ACCOUNT_ID,
  type: 'expense',
  amountMinor: '45000',
  currency: 'INR',
  description: 'Groceries',
  tags: [],
  status: 'active',
  occurredAt: TIMESTAMP,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
} satisfies TransactionDto;

const budget = {
  id: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e73',
  userId: USER_ID,
  name: 'Monthly groceries',
  limitMinor: '1500000',
  currency: 'INR',
  period: 'monthly',
  startDate: '2026-10-01',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
} satisfies BudgetDto;

describe('primitive schemas', () => {
  it('accepts only supported ISO 4217 currency codes', () => {
    expect(currencyCodeSchema.safeParse('INR').success).toBe(true);
    expect(currencyCodeSchema.safeParse('inr').success).toBe(false);
    expect(currencyCodeSchema.safeParse('XYZ').success).toBe(false);
  });

  it('validates minor-unit amounts as canonical integer strings, never numbers', () => {
    expect(minorUnitsSchema.safeParse('-2500').success).toBe(true);
    expect(minorUnitsSchema.safeParse(2500).success).toBe(false);
    expect(minorUnitsSchema.safeParse('25.00').success).toBe(false);
    expect(minorUnitsSchema.safeParse('9223372036854775808').success).toBe(false);
  });

  it('requires strictly positive amounts where a sign makes no sense', () => {
    expect(positiveMinorUnitsSchema.safeParse('1').success).toBe(true);
    expect(positiveMinorUnitsSchema.safeParse('0').success).toBe(false);
    expect(positiveMinorUnitsSchema.safeParse('-1').success).toBe(false);
  });

  it('validates IANA time zones', () => {
    expect(timeZoneSchema.safeParse('Asia/Kolkata').success).toBe(true);
    expect(timeZoneSchema.safeParse('UTC').success).toBe(true);
    expect(timeZoneSchema.safeParse('Mars/Olympus_Mons').success).toBe(false);
  });

  it('requires UTC ISO timestamps', () => {
    expect(isoDateTimeSchema.safeParse(TIMESTAMP).success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-10-25T15:00:00+05:30').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('25/10/2026').success).toBe(false);
  });
});

describe('userDtoSchema', () => {
  it('accepts a valid user', () => {
    const result = userDtoSchema.safeParse({
      id: USER_ID,
      name: 'Asha',
      email: 'asha@example.com',
      preferredCurrency: 'INR',
      timezone: 'Asia/Kolkata',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    expect(result.success).toBe(true);
  });

  it('never passes through unknown fields such as credentials', () => {
    const result = userDtoSchema.parse({
      id: USER_ID,
      name: 'Asha',
      email: 'asha@example.com',
      preferredCurrency: 'INR',
      timezone: 'Asia/Kolkata',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      passwordHash: 'should-not-survive',
    });
    expect(result).not.toHaveProperty('passwordHash');
  });
});

describe('transactionDtoSchema', () => {
  it('accepts income and expense transactions', () => {
    expect(transactionDtoSchema.safeParse(expense).success).toBe(true);
    expect(
      transactionDtoSchema.safeParse({ ...expense, type: 'income', amountMinor: '5000000' })
        .success,
    ).toBe(true);
  });

  it('rejects non-positive and non-string amounts', () => {
    expect(transactionDtoSchema.safeParse({ ...expense, amountMinor: '0' }).success).toBe(false);
    expect(transactionDtoSchema.safeParse({ ...expense, amountMinor: '-45000' }).success).toBe(
      false,
    );
    expect(transactionDtoSchema.safeParse({ ...expense, amountMinor: 450.0 }).success).toBe(false);
  });

  it('rejects unknown transaction types', () => {
    expect(transactionDtoSchema.safeParse({ ...expense, type: 'refund' }).success).toBe(false);
  });

  it('accepts balance adjustments only with a direction and without a category', () => {
    const adjustment = { ...expense, type: 'balance_adjustment', adjustmentDirection: 'increase' };
    expect(transactionDtoSchema.safeParse(adjustment).success).toBe(true);
    const { adjustmentDirection: _omitted, ...withoutDirection } = adjustment;
    expect(transactionDtoSchema.safeParse(withoutDirection).success).toBe(false);
    expect(
      transactionDtoSchema.safeParse({ ...adjustment, adjustmentDirection: 'sideways' }).success,
    ).toBe(false);
  });

  it('keeps the void state and its timestamp consistent', () => {
    expect(transactionDtoSchema.safeParse({ ...expense, status: 'voided' }).success).toBe(false);
    expect(
      transactionDtoSchema.safeParse({ ...expense, status: 'voided', voidedAt: TIMESTAMP }).success,
    ).toBe(true);
    expect(transactionDtoSchema.safeParse({ ...expense, voidedAt: TIMESTAMP }).success).toBe(false);
  });

  it('requires a distinct destination account for transfers', () => {
    const transfer = { ...expense, type: 'transfer', transferAccountId: OTHER_ACCOUNT_ID };
    expect(transactionDtoSchema.safeParse(transfer).success).toBe(true);

    const { transferAccountId: _omitted, ...withoutDestination } = transfer;
    expect(transactionDtoSchema.safeParse(withoutDestination).success).toBe(false);

    const toSameAccount = { ...transfer, transferAccountId: ACCOUNT_ID };
    const result = transactionDtoSchema.safeParse(toSameAccount);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['transferAccountId']);
  });

  it('treats optional fields as absent, not undefined', () => {
    expect(transactionDtoSchema.safeParse({ ...expense, merchant: 'FreshMart' }).success).toBe(
      true,
    );
    expect(transactionDtoSchema.safeParse({ ...expense, merchant: undefined }).success).toBe(false);
  });
});

describe('budgetDtoSchema', () => {
  it('accepts an open-ended recurring budget', () => {
    expect(budgetDtoSchema.safeParse(budget).success).toBe(true);
  });

  it('rejects an end date before the start date', () => {
    const result = budgetDtoSchema.safeParse({ ...budget, endDate: '2026-09-30' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endDate']);
  });

  it('requires an end date for custom periods', () => {
    expect(budgetDtoSchema.safeParse({ ...budget, period: 'custom' }).success).toBe(false);
    expect(
      budgetDtoSchema.safeParse({ ...budget, period: 'custom', endDate: '2026-12-31' }).success,
    ).toBe(true);
  });

  it('rejects impossible calendar dates', () => {
    expect(budgetDtoSchema.safeParse({ ...budget, startDate: '2026-02-30' }).success).toBe(false);
  });
});

describe('API envelopes', () => {
  it('parses a success envelope with a typed payload', () => {
    const schema = apiSuccessResponseSchema(healthCheckDtoSchema);
    const parsed = schema.parse({
      success: true,
      data: { status: 'ok', uptimeSeconds: 12.5, timestamp: TIMESTAMP },
    });
    expect(parsed.data.status).toBe('ok');
  });

  it('parses an error envelope and rejects unknown error codes', () => {
    expect(
      apiErrorResponseSchema.safeParse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: 'req-1' },
      }).success,
    ).toBe(true);
    expect(
      apiErrorResponseSchema.safeParse({
        success: false,
        error: { code: 'TEAPOT', message: 'I am a teapot.' },
      }).success,
    ).toBe(false);
  });
});
