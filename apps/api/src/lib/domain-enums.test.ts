import {
  ACCOUNT_COLORS,
  ACCOUNT_TYPES,
  ADJUSTMENT_DIRECTIONS,
  AUTOMATION_JOB_STATUSES,
  BUDGET_PERIODS,
  CATEGORY_KINDS,
  DELIVERY_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_TYPES,
  OCCURRENCE_STATES,
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  TRANSACTION_TYPES,
  type AccountColor,
  type AccountType,
  type AdjustmentDirection,
  type AutomationJobStatus,
  type BudgetPeriod,
  type CategoryKind,
  type DeliveryChannel,
  type NotificationDeliveryStatus,
  type NotificationType,
  type OccurrenceState,
  type PaymentMethod,
  type RecurringFrequency,
  type TransactionType,
} from '@calmcash/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as PrismaEnums from '../generated/prisma/enums';

// The database enums (prisma/schema.prisma) and the shared API literals must never drift:
// DTO mapping relies on them being identical, so no translation table is needed.
describe('Prisma enums ⇄ shared domain literals', () => {
  it('have identical runtime values', () => {
    expect(Object.values(PrismaEnums.AccountType)).toEqual([...ACCOUNT_TYPES]);
    expect(Object.values(PrismaEnums.AccountColor)).toEqual([...ACCOUNT_COLORS]);
    expect(Object.values(PrismaEnums.TransactionType)).toEqual([...TRANSACTION_TYPES]);
    expect(Object.values(PrismaEnums.CategoryKind)).toEqual([...CATEGORY_KINDS]);
    expect(Object.values(PrismaEnums.BudgetPeriod)).toEqual([...BUDGET_PERIODS]);
    expect(Object.values(PrismaEnums.AdjustmentDirection)).toEqual([...ADJUSTMENT_DIRECTIONS]);
    expect(Object.values(PrismaEnums.PaymentMethod)).toEqual([...PAYMENT_METHODS]);
    expect(Object.values(PrismaEnums.RecurringFrequency)).toEqual([...RECURRING_FREQUENCIES]);
    expect(Object.values(PrismaEnums.OccurrenceState)).toEqual([...OCCURRENCE_STATES]);
    expect(Object.values(PrismaEnums.NotificationType)).toEqual([...NOTIFICATION_TYPES]);
    expect(Object.values(PrismaEnums.DeliveryChannel)).toEqual([...DELIVERY_CHANNELS]);
    expect(Object.values(PrismaEnums.NotificationDeliveryStatus)).toEqual([
      ...NOTIFICATION_DELIVERY_STATUSES,
    ]);
    expect(Object.values(PrismaEnums.AutomationJobStatus)).toEqual([...AUTOMATION_JOB_STATUSES]);
  });

  it('have identical types', () => {
    expectTypeOf<PrismaEnums.AccountType>().toEqualTypeOf<AccountType>();
    expectTypeOf<PrismaEnums.AccountColor>().toEqualTypeOf<AccountColor>();
    expectTypeOf<PrismaEnums.TransactionType>().toEqualTypeOf<TransactionType>();
    expectTypeOf<PrismaEnums.CategoryKind>().toEqualTypeOf<CategoryKind>();
    expectTypeOf<PrismaEnums.BudgetPeriod>().toEqualTypeOf<BudgetPeriod>();
    expectTypeOf<PrismaEnums.AdjustmentDirection>().toEqualTypeOf<AdjustmentDirection>();
    expectTypeOf<PrismaEnums.PaymentMethod>().toEqualTypeOf<PaymentMethod>();
    expectTypeOf<PrismaEnums.RecurringFrequency>().toEqualTypeOf<RecurringFrequency>();
    expectTypeOf<PrismaEnums.OccurrenceState>().toEqualTypeOf<OccurrenceState>();
    expectTypeOf<PrismaEnums.NotificationType>().toEqualTypeOf<NotificationType>();
    expectTypeOf<PrismaEnums.DeliveryChannel>().toEqualTypeOf<DeliveryChannel>();
    expectTypeOf<PrismaEnums.NotificationDeliveryStatus>().toEqualTypeOf<NotificationDeliveryStatus>();
    expectTypeOf<PrismaEnums.AutomationJobStatus>().toEqualTypeOf<AutomationJobStatus>();
  });
});
