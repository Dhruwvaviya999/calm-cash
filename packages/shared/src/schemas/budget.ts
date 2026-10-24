import { z } from 'zod';

import { BUDGET_PERIODS, TEXT_LIMITS } from '../constants/domain';
import type { BudgetDto } from '../types/budget';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  positiveMinorUnitsSchema,
} from './common';

export const budgetPeriodSchema = z.enum(BUDGET_PERIODS);

export const budgetDtoSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(TEXT_LIMITS.budgetName),
    categoryId: entityIdSchema.exactOptional(),
    limitMinor: positiveMinorUnitsSchema,
    currency: currencyCodeSchema,
    period: budgetPeriodSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema.exactOptional(),
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
  }) satisfies z.ZodType<BudgetDto>;
