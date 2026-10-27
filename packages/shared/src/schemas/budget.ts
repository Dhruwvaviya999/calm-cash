import { z } from 'zod';

import { BUDGET_PERIODS, TEXT_LIMITS } from '../constants/domain';
import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import {
  BUDGET_PROGRESS_STATUSES,
  BUDGET_STATUS_FILTERS,
  BUDGET_STATUSES,
  BUDGET_TIMINGS,
  MAX_BUDGET_ALERT_THRESHOLD_BP,
  MAX_BUDGET_ALERT_THRESHOLDS,
  MIN_BUDGET_ALERT_THRESHOLD_BP,
  RECURRING_BUDGET_PERIODS,
} from '../constants/planning';
import { tryParseMinorUnits } from '../money/minor-units';
import { alertThresholdProblems } from '../planning/budget-progress';
import type {
  BudgetDetailQuery,
  BudgetDto,
  BudgetListDto,
  BudgetListQuery,
  BudgetPeriodTotalsDto,
  BudgetProgressDto,
  BudgetSummaryDto,
  BudgetSummaryQuery,
  BudgetWithProgressDto,
  CreateBudgetInput,
  PlanningCategoryRefDto,
  UpdateBudgetInput,
} from '../types/budget';
import { categoryKindSchema, categoryStatusSchema } from './category';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
  singleLineTextSchema,
} from './common';
import { ratioDtoSchema } from './dashboard';

export const budgetPeriodSchema = z.enum(BUDGET_PERIODS, { error: 'Choose a budget period.' });
export const recurringBudgetPeriodSchema = z.enum(RECURRING_BUDGET_PERIODS);
export const budgetStatusSchema = z.enum(BUDGET_STATUSES);
export const budgetStatusFilterSchema = z.enum(BUDGET_STATUS_FILTERS);
export const budgetProgressStatusSchema = z.enum(BUDGET_PROGRESS_STATUSES);
export const budgetTimingSchema = z.enum(BUDGET_TIMINGS);

// --- Fields --------------------------------------------------------------------------------------

export const budgetNameSchema = singleLineTextSchema(
  TEXT_LIMITS.budgetName,
  'Give this budget a name.',
);

export const budgetDescriptionSchema = singleLineTextSchema(
  TEXT_LIMITS.budgetDescription,
  'Enter a description, or leave it empty.',
);

/** A limit a person entered: positive, within the enterable range. */
export const budgetLimitMinorSchema = z.string({ error: 'Enter a limit.' }).refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return parsed !== undefined && parsed > 0n && parsed <= MAX_ENTERED_AMOUNT_MINOR;
  },
  { error: 'Enter a limit above zero, in minor units, e.g. "2000000".' },
);

const budgetDateSchema = isoDateSchema.refine((value) => value >= '1900-01-01', {
  error: 'Choose a date after 1900.',
});

/** Ascending, distinct, 1 %–99 %, at most three; `[]` turns alerts off. */
export const alertThresholdsSchema = z
  .array(
    z
      .number({ error: 'Alerts are whole basis points.' })
      .int({ error: 'Alerts are whole basis points.' }),
  )
  .superRefine((thresholds, context) => {
    for (const message of alertThresholdProblems(thresholds)) {
      context.addIssue({ code: 'custom', message });
    }
  });

function checkBudgetShape(
  input: { period?: string; startDate?: string; endDate?: string | null },
  context: z.RefinementCtx,
): void {
  // ISO `YYYY-MM-DD` strings sort chronologically.
  if (
    input.startDate !== undefined &&
    typeof input.endDate === 'string' &&
    input.endDate < input.startDate
  ) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'The end date must be on or after the start date.',
    });
  }
  if (input.period === 'custom' && input.endDate === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'A custom period needs an end date.',
    });
  }
}

// --- Requests ------------------------------------------------------------------------------------
// Strict objects: owner IDs, statuses, and archive times are rejected, never ignored.

export const createBudgetInputSchema = z
  .strictObject({
    name: budgetNameSchema,
    description: budgetDescriptionSchema.exactOptional(),
    categoryId: entityIdSchema.exactOptional(),
    limitMinor: budgetLimitMinorSchema,
    currency: currencyCodeSchema,
    period: budgetPeriodSchema,
    startDate: budgetDateSchema,
    endDate: budgetDateSchema.exactOptional(),
    alertThresholdsBp: alertThresholdsSchema.exactOptional(),
  })
  .superRefine(checkBudgetShape) satisfies z.ZodType<CreateBudgetInput>;

export const updateBudgetInputSchema = z
  .strictObject({
    name: budgetNameSchema.exactOptional(),
    description: budgetDescriptionSchema.nullable().exactOptional(),
    categoryId: entityIdSchema.nullable().exactOptional(),
    limitMinor: budgetLimitMinorSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
    period: budgetPeriodSchema.exactOptional(),
    startDate: budgetDateSchema.exactOptional(),
    endDate: budgetDateSchema.nullable().exactOptional(),
    alertThresholdsBp: alertThresholdsSchema.exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateBudgetInput>;

// --- Queries -------------------------------------------------------------------------------------

export const budgetListQuerySchema = z.strictObject({
  status: budgetStatusFilterSchema.default('active'),
  period: budgetPeriodSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  currency: currencyCodeSchema.exactOptional(),
  date: budgetDateSchema.exactOptional(),
}) satisfies z.ZodType<BudgetListQuery>;

export const budgetDetailQuerySchema = z.strictObject({
  date: budgetDateSchema.exactOptional(),
}) satisfies z.ZodType<BudgetDetailQuery>;

export const budgetSummaryQuerySchema = z.strictObject({
  date: budgetDateSchema.exactOptional(),
  currency: currencyCodeSchema.exactOptional(),
}) satisfies z.ZodType<BudgetSummaryQuery>;

// --- Responses -----------------------------------------------------------------------------------

const thresholdDtoSchema = z
  .number()
  .int()
  .min(MIN_BUDGET_ALERT_THRESHOLD_BP)
  .max(MAX_BUDGET_ALERT_THRESHOLD_BP);

export const budgetDtoSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(TEXT_LIMITS.budgetName),
    description: z.string().min(1).max(TEXT_LIMITS.budgetDescription).exactOptional(),
    categoryId: entityIdSchema.exactOptional(),
    limitMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    period: budgetPeriodSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema.exactOptional(),
    alertThresholdsBp: z.array(thresholdDtoSchema).max(MAX_BUDGET_ALERT_THRESHOLDS),
    status: budgetStatusSchema,
    archivedAt: isoDateTimeSchema.exactOptional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  // ISO `YYYY-MM-DD` strings sort chronologically, so string comparison is exact here.
  .refine((budget) => budget.endDate === undefined || budget.endDate >= budget.startDate, {
    message: 'endDate must be on or after startDate.',
    path: ['endDate'],
  })
  .refine((budget) => budget.period !== 'custom' || budget.endDate !== undefined, {
    message: 'A custom budget period requires an endDate.',
    path: ['endDate'],
  })
  .refine((budget) => (budget.status === 'archived') === (budget.archivedAt !== undefined), {
    message: 'Archived budgets, and only those, have an archive time.',
    path: ['archivedAt'],
  }) satisfies z.ZodType<BudgetDto>;

export const planningCategoryRefDtoSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.categoryName),
  kind: categoryKindSchema,
  parentId: entityIdSchema.exactOptional(),
  parentName: z.string().min(1).max(TEXT_LIMITS.categoryName).exactOptional(),
  status: categoryStatusSchema,
}) satisfies z.ZodType<PlanningCategoryRefDto>;

export const budgetProgressDtoSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  partial: z.boolean(),
  timing: budgetTimingSchema,
  limitMinor: positiveMinorUnitsSchema,
  spentMinor: minorUnitsSchema,
  remainingMinor: minorUnitsSchema,
  used: ratioDtoSchema,
  status: budgetProgressStatusSchema,
  reachedThresholdBp: thresholdDtoSchema.exactOptional(),
  transactionCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<BudgetProgressDto>;

export const budgetWithProgressDtoSchema = z.object({
  budget: budgetDtoSchema,
  category: planningCategoryRefDtoSchema.exactOptional(),
  progress: budgetProgressDtoSchema,
}) satisfies z.ZodType<BudgetWithProgressDto>;

export const budgetListDtoSchema = z.object({
  date: isoDateSchema,
  budgets: z.array(budgetWithProgressDtoSchema),
}) satisfies z.ZodType<BudgetListDto>;

export const budgetPeriodTotalsDtoSchema = z.object({
  period: recurringBudgetPeriodSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  budgetCount: z.number().int().positive(),
  scope: z.enum(['overall', 'categories']),
  limitMinor: positiveMinorUnitsSchema,
  spentMinor: minorUnitsSchema,
  remainingMinor: minorUnitsSchema,
  used: ratioDtoSchema,
}) satisfies z.ZodType<BudgetPeriodTotalsDto>;

const statusCount = z.number().int().nonnegative();

export const budgetSummaryDtoSchema = z.object({
  date: isoDateSchema,
  currency: currencyCodeSchema.exactOptional(),
  currencies: z.array(currencyCodeSchema),
  statusCounts: z.object({
    on_track: statusCount,
    approaching_limit: statusCount,
    limit_reached: statusCount,
    over_budget: statusCount,
    not_applicable: statusCount,
  }),
  totals: z.array(budgetPeriodTotalsDtoSchema),
  highlights: z.array(budgetWithProgressDtoSchema),
}) satisfies z.ZodType<BudgetSummaryDto>;
