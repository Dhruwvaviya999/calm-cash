import {
  ACCOUNT_TYPES,
  BUDGET_PERIODS,
  CATEGORY_KINDS,
  TRANSACTION_TYPES,
  type AccountType,
  type BudgetPeriod,
  type CategoryKind,
  type TransactionType,
} from '@calmcash/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as PrismaEnums from '../generated/prisma/enums';

// The database enums (prisma/schema.prisma) and the shared API literals must never drift:
// DTO mapping relies on them being identical, so no translation table is needed.
describe('Prisma enums ⇄ shared domain literals', () => {
  it('have identical runtime values', () => {
    expect(Object.values(PrismaEnums.AccountType)).toEqual([...ACCOUNT_TYPES]);
    expect(Object.values(PrismaEnums.TransactionType)).toEqual([...TRANSACTION_TYPES]);
    expect(Object.values(PrismaEnums.CategoryKind)).toEqual([...CATEGORY_KINDS]);
    expect(Object.values(PrismaEnums.BudgetPeriod)).toEqual([...BUDGET_PERIODS]);
  });

  it('have identical types', () => {
    expectTypeOf<PrismaEnums.AccountType>().toEqualTypeOf<AccountType>();
    expectTypeOf<PrismaEnums.TransactionType>().toEqualTypeOf<TransactionType>();
    expectTypeOf<PrismaEnums.CategoryKind>().toEqualTypeOf<CategoryKind>();
    expectTypeOf<PrismaEnums.BudgetPeriod>().toEqualTypeOf<BudgetPeriod>();
  });
});
