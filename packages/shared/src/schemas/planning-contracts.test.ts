import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type {
  BudgetListDto,
  BudgetListQuery,
  BudgetSummaryDto,
  BudgetWithProgressDto,
  CreateBudgetInput,
  UpdateBudgetInput,
} from '../types/budget';
import type {
  CreateSavingsGoalInput,
  GoalContributionInput,
  SavingsGoalDetailDto,
  SavingsGoalListDto,
  UpdateSavingsGoalInput,
} from '../types/goal';
import type {
  CreateRecurringScheduleInput,
  OccurrenceDto,
  RecordedOccurrenceDto,
  RecordOccurrenceInput,
  RecurringListQuery,
  RecurringScheduleDetailDto,
  RecurringScheduleListDto,
  UpcomingOccurrencesDto,
  UpcomingOccurrencesQuery,
  UpdateRecurringScheduleInput,
} from '../types/recurring';
import type {
  CreateSubscriptionInput,
  SubscriptionListDto,
  SubscriptionSummaryDto,
} from '../types/subscription';
import type { budgetListQuerySchema } from './budget';
import {
  createBudgetInputSchema,
  updateBudgetInputSchema,
  type budgetListDtoSchema,
  type budgetSummaryDtoSchema,
  type budgetWithProgressDtoSchema,
} from './budget';
import {
  createSavingsGoalInputSchema,
  goalContributionInputSchema,
  type savingsGoalDetailDtoSchema,
  type savingsGoalListDtoSchema,
  type updateSavingsGoalInputSchema,
} from './goal';
import type { updateRecurringScheduleInputSchema } from './recurring';
import {
  createRecurringScheduleInputSchema,
  recordOccurrenceInputSchema,
  recurringListQuerySchema,
  upcomingOccurrencesQuerySchema,
  type occurrenceDtoSchema,
  type recordedOccurrenceDtoSchema,
  type recurringScheduleDetailDtoSchema,
  type recurringScheduleListDtoSchema,
  type upcomingOccurrencesDtoSchema,
} from './recurring';
import {
  createSubscriptionInputSchema,
  type subscriptionListDtoSchema,
  type subscriptionSummaryDtoSchema,
} from './subscription';

const BASE_BUDGET = {
  name: 'Groceries',
  limitMinor: '1500000',
  currency: 'INR',
  period: 'monthly',
  startDate: '2026-10-01',
};

describe('planning schema ⇄ interface contracts', () => {
  it('infers exactly the budget types', () => {
    expectTypeOf<z.output<typeof createBudgetInputSchema>>().toEqualTypeOf<CreateBudgetInput>();
    expectTypeOf<z.output<typeof updateBudgetInputSchema>>().toEqualTypeOf<UpdateBudgetInput>();
    expectTypeOf<z.output<typeof budgetListQuerySchema>>().toEqualTypeOf<BudgetListQuery>();
    expectTypeOf<
      z.output<typeof budgetWithProgressDtoSchema>
    >().toEqualTypeOf<BudgetWithProgressDto>();
    expectTypeOf<z.output<typeof budgetListDtoSchema>>().toEqualTypeOf<BudgetListDto>();
    expectTypeOf<z.output<typeof budgetSummaryDtoSchema>>().toEqualTypeOf<BudgetSummaryDto>();
  });

  it('infers exactly the recurring and subscription types', () => {
    expectTypeOf<
      z.output<typeof createRecurringScheduleInputSchema>
    >().toEqualTypeOf<CreateRecurringScheduleInput>();
    expectTypeOf<
      z.output<typeof updateRecurringScheduleInputSchema>
    >().toEqualTypeOf<UpdateRecurringScheduleInput>();
    expectTypeOf<
      z.output<typeof recordOccurrenceInputSchema>
    >().toEqualTypeOf<RecordOccurrenceInput>();
    expectTypeOf<z.output<typeof recurringListQuerySchema>>().toEqualTypeOf<RecurringListQuery>();
    expectTypeOf<
      z.output<typeof upcomingOccurrencesQuerySchema>
    >().toEqualTypeOf<UpcomingOccurrencesQuery>();
    expectTypeOf<z.output<typeof occurrenceDtoSchema>>().toEqualTypeOf<OccurrenceDto>();
    expectTypeOf<
      z.output<typeof recurringScheduleListDtoSchema>
    >().toEqualTypeOf<RecurringScheduleListDto>();
    expectTypeOf<
      z.output<typeof recurringScheduleDetailDtoSchema>
    >().toEqualTypeOf<RecurringScheduleDetailDto>();
    expectTypeOf<
      z.output<typeof upcomingOccurrencesDtoSchema>
    >().toEqualTypeOf<UpcomingOccurrencesDto>();
    expectTypeOf<
      z.output<typeof recordedOccurrenceDtoSchema>
    >().toEqualTypeOf<RecordedOccurrenceDto>();
    expectTypeOf<
      z.output<typeof createSubscriptionInputSchema>
    >().toEqualTypeOf<CreateSubscriptionInput>();
    expectTypeOf<z.output<typeof subscriptionListDtoSchema>>().toEqualTypeOf<SubscriptionListDto>();
    expectTypeOf<
      z.output<typeof subscriptionSummaryDtoSchema>
    >().toEqualTypeOf<SubscriptionSummaryDto>();
  });

  it('infers exactly the savings-goal types', () => {
    expectTypeOf<
      z.output<typeof createSavingsGoalInputSchema>
    >().toEqualTypeOf<CreateSavingsGoalInput>();
    expectTypeOf<
      z.output<typeof updateSavingsGoalInputSchema>
    >().toEqualTypeOf<UpdateSavingsGoalInput>();
    expectTypeOf<
      z.output<typeof goalContributionInputSchema>
    >().toEqualTypeOf<GoalContributionInput>();
    expectTypeOf<z.output<typeof savingsGoalListDtoSchema>>().toEqualTypeOf<SavingsGoalListDto>();
    expectTypeOf<
      z.output<typeof savingsGoalDetailDtoSchema>
    >().toEqualTypeOf<SavingsGoalDetailDto>();
  });
});

describe('budget request schemas', () => {
  it('accepts a simple monthly budget and an overall budget without a category', () => {
    expect(createBudgetInputSchema.safeParse(BASE_BUDGET).success).toBe(true);
    expect(
      createBudgetInputSchema.safeParse({
        ...BASE_BUDGET,
        categoryId: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e6f',
      }).success,
    ).toBe(true);
  });

  it('rejects protected fields, bad limits, and inconsistent dates', () => {
    expect(createBudgetInputSchema.safeParse({ ...BASE_BUDGET, userId: 'x' }).success).toBe(false);
    expect(createBudgetInputSchema.safeParse({ ...BASE_BUDGET, status: 'archived' }).success).toBe(
      false,
    );
    expect(createBudgetInputSchema.safeParse({ ...BASE_BUDGET, limitMinor: '0' }).success).toBe(
      false,
    );
    expect(createBudgetInputSchema.safeParse({ ...BASE_BUDGET, limitMinor: '10.5' }).success).toBe(
      false,
    );
    expect(createBudgetInputSchema.safeParse({ ...BASE_BUDGET, limitMinor: 1000 }).success).toBe(
      false,
    );
    expect(createBudgetInputSchema.safeParse({ ...BASE_BUDGET, period: 'custom' }).success).toBe(
      false,
    );
    expect(
      createBudgetInputSchema.safeParse({ ...BASE_BUDGET, endDate: '2026-09-30' }).success,
    ).toBe(false);
    expect(
      createBudgetInputSchema.safeParse({ ...BASE_BUDGET, alertThresholdsBp: [9000, 8000] })
        .success,
    ).toBe(false);
    expect(updateBudgetInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('recurring request schemas', () => {
  const base = {
    name: 'Rent',
    type: 'expense',
    amountMinor: '2500000',
    currency: 'INR',
    frequency: 'monthly',
    startDate: '2026-11-01',
  };

  it('accepts supported intervals and rejects others', () => {
    expect(createRecurringScheduleInputSchema.safeParse({ ...base, interval: 3 }).success).toBe(
      true,
    );
    expect(
      createRecurringScheduleInputSchema.safeParse({ ...base, frequency: 'weekly', interval: 2 })
        .success,
    ).toBe(true);
    expect(createRecurringScheduleInputSchema.safeParse({ ...base, interval: 25 }).success).toBe(
      false,
    );
    expect(createRecurringScheduleInputSchema.safeParse({ ...base, interval: 0 }).success).toBe(
      false,
    );
    expect(
      createRecurringScheduleInputSchema.safeParse({ ...base, type: 'transfer' }).success,
    ).toBe(false);
  });

  it('never lets clients set state', () => {
    expect(
      createRecurringScheduleInputSchema.safeParse({ ...base, nextOccurrenceDate: '2026-11-01' })
        .success,
    ).toBe(false);
    expect(createSubscriptionInputSchema.safeParse({ ...base }).success).toBe(false); // no `type`
    const { type: _type, ...subscription } = base;
    expect(createSubscriptionInputSchema.safeParse(subscription).success).toBe(true);
    expect(recordOccurrenceInputSchema.safeParse({ transactionId: 'x' }).success).toBe(false);
  });

  it('parses query flags strictly', () => {
    expect(recurringListQuerySchema.parse({ subscription: 'true' })).toEqual({
      status: 'current',
      subscription: true,
    });
    expect(recurringListQuerySchema.safeParse({ subscription: 'yes' }).success).toBe(false);
    expect(
      upcomingOccurrencesQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success,
    ).toBe(false);
  });
});

describe('goal request schemas', () => {
  it('validates targets and contributions exactly', () => {
    const goal = { name: 'Holiday', targetMinor: '20000000', currency: 'INR' };
    expect(createSavingsGoalInputSchema.safeParse(goal).success).toBe(true);
    expect(createSavingsGoalInputSchema.safeParse({ ...goal, targetMinor: '0' }).success).toBe(
      false,
    );
    expect(goalContributionInputSchema.safeParse({ kind: 'add', amountMinor: '100' }).success).toBe(
      true,
    );
    expect(
      goalContributionInputSchema.safeParse({ kind: 'add', amountMinor: '-100' }).success,
    ).toBe(false);
    expect(goalContributionInputSchema.safeParse({ kind: 'set', savedMinor: '0' }).success).toBe(
      true,
    );
    expect(goalContributionInputSchema.safeParse({ kind: 'set', amountMinor: '1' }).success).toBe(
      false,
    );
  });
});
