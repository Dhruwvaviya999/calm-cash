import { z } from 'zod';

import { SUBSCRIPTION_STATUSES } from '../constants/planning';
import type {
  CancelSubscriptionInput,
  CostEstimateDto,
  CreateSubscriptionInput,
  SubscriptionCurrencySummaryDto,
  SubscriptionDto,
  SubscriptionListDto,
  SubscriptionListQuery,
  SubscriptionSummaryDto,
  UpdateSubscriptionInput,
} from '../types/subscription';
import { currencyCodeSchema, isoDateSchema, minorUnitsSchema } from './common';
import {
  checkSchedule,
  recurringScheduleItemDtoSchema,
  recurringStatusFilterSchema,
  scheduleInputShape,
  updateRecurringScheduleInputSchema,
} from './recurring';

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

// --- Requests ------------------------------------------------------------------------------------

export const createSubscriptionInputSchema = z
  .strictObject(scheduleInputShape)
  .superRefine(checkSchedule) satisfies z.ZodType<CreateSubscriptionInput>;

export const updateSubscriptionInputSchema =
  updateRecurringScheduleInputSchema satisfies z.ZodType<UpdateSubscriptionInput>;

export const cancelSubscriptionInputSchema = z.strictObject({
  effectiveDate: isoDateSchema
    .refine((value) => value >= '1900-01-01', { error: 'Choose a date after 1900.' })
    .exactOptional(),
}) satisfies z.ZodType<CancelSubscriptionInput>;

export const subscriptionListQuerySchema = z.strictObject({
  status: recurringStatusFilterSchema.default('current'),
}) satisfies z.ZodType<SubscriptionListQuery>;

// --- Responses -----------------------------------------------------------------------------------

export const costEstimateDtoSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  occurrences: z.number().int().nonnegative(),
  amountMinor: minorUnitsSchema,
}) satisfies z.ZodType<CostEstimateDto>;

export const subscriptionDtoSchema = z.object({
  ...recurringScheduleItemDtoSchema.shape,
  status: subscriptionStatusSchema,
  nextTwelveMonths: costEstimateDtoSchema,
}) satisfies z.ZodType<SubscriptionDto>;

export const subscriptionListDtoSchema = z.object({
  today: isoDateSchema,
  subscriptions: z.array(subscriptionDtoSchema),
}) satisfies z.ZodType<SubscriptionListDto>;

export const subscriptionCurrencySummaryDtoSchema = z.object({
  currency: currencyCodeSchema,
  activeCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  overdueMinor: minorUnitsSchema,
  next30Days: costEstimateDtoSchema,
  next12Months: costEstimateDtoSchema,
}) satisfies z.ZodType<SubscriptionCurrencySummaryDto>;

export const subscriptionSummaryDtoSchema = z.object({
  today: isoDateSchema,
  currencies: z.array(subscriptionCurrencySummaryDtoSchema),
}) satisfies z.ZodType<SubscriptionSummaryDto>;
