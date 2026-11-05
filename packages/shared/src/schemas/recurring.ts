import { z } from 'zod';

import { TEXT_LIMITS } from '../constants/domain';
import {
  MAX_RECURRING_INTERVAL,
  MAX_REMINDER_DAYS,
  OCCURRENCE_STATUSES,
  RECURRING_FREQUENCIES,
  RECURRING_SCHEDULE_STATUSES,
  RECURRING_STATUS_FILTERS,
  RECURRING_TYPES,
} from '../constants/planning';
import type {
  CreateRecurringScheduleInput,
  EndRecurringScheduleInput,
  ExpectedTotalsDto,
  LinkOccurrenceInput,
  OccurrenceLinkCandidatesDto,
  OccurrenceActionResultDto,
  OccurrenceDto,
  PostponeOccurrenceInput,
  RecordedOccurrenceDto,
  RecordOccurrenceInput,
  RecurringListQuery,
  RecurringScheduleDetailDto,
  RecurringScheduleDto,
  RecurringScheduleItemDto,
  RecurringScheduleListDto,
  UpcomingOccurrenceDto,
  UpcomingOccurrencesDto,
  UpcomingOccurrencesQuery,
  UpdateRecurringScheduleInput,
} from '../types/recurring';
import { planningCategoryRefDtoSchema } from './budget';
import {
  booleanQuerySchema,
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
  singleLineTextSchema,
} from './common';
import {
  paymentMethodSchema,
  tagListSchema,
  transactionAccountRefDtoSchema,
  transactionAmountMinorSchema,
  transactionDescriptionSchema,
  transactionListItemDtoSchema,
  transactionMerchantSchema,
  transactionNotesSchema,
  transactionStatusSchema,
} from './transaction';

export const recurringTypeSchema = z.enum(RECURRING_TYPES, {
  error: 'Choose income or an expense.',
});
export const recurringFrequencySchema = z.enum(RECURRING_FREQUENCIES, {
  error: 'Choose how often it repeats.',
});
export const recurringScheduleStatusSchema = z.enum(RECURRING_SCHEDULE_STATUSES);
export const recurringStatusFilterSchema = z.enum(RECURRING_STATUS_FILTERS);
export const occurrenceStatusSchema = z.enum(OCCURRENCE_STATUSES);

// --- Fields --------------------------------------------------------------------------------------

export const scheduleNameSchema = singleLineTextSchema(
  TEXT_LIMITS.scheduleName,
  'Give this a name, e.g. "Rent".',
);

const scheduleDateSchema = isoDateSchema.refine((value) => value >= '1900-01-01', {
  error: 'Choose a date after 1900.',
});

const intervalSchema = z
  .number({ error: 'Enter how many weeks, months, or years apart.' })
  .int({ error: 'Use a whole number.' })
  .min(1, { error: 'Use at least 1.' })
  .max(52, { error: 'Use at most 52.' });

const reminderDaysSchema = z
  .number({ error: 'Enter a number of days.' })
  .int({ error: 'Use a whole number of days.' })
  .min(0, { error: 'Use 0 or more days.' })
  .max(MAX_REMINDER_DAYS, { error: `Use at most ${MAX_REMINDER_DAYS} days.` });

export function checkSchedule(
  input: {
    frequency?: keyof typeof MAX_RECURRING_INTERVAL;
    interval?: number;
    startDate?: string;
    endDate?: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (input.frequency !== undefined && input.interval !== undefined) {
    const max = MAX_RECURRING_INTERVAL[input.frequency];
    if (input.interval > max) {
      context.addIssue({
        code: 'custom',
        path: ['interval'],
        message: `Use at most ${max} for this frequency.`,
      });
    }
  }
  if (
    input.startDate !== undefined &&
    typeof input.endDate === 'string' &&
    input.endDate < input.startDate
  ) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'The end date must be on or after the first date.',
    });
  }
}

// --- Requests ------------------------------------------------------------------------------------
// Strict objects: owner IDs, statuses, cursors, and subscription flags are never accepted here.

/** Fields of a new schedule other than its type (subscriptions are always expenses). */
export const scheduleInputShape = {
  name: scheduleNameSchema,
  amountMinor: transactionAmountMinorSchema,
  currency: currencyCodeSchema.exactOptional(),
  accountId: entityIdSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  merchant: transactionMerchantSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
  notes: transactionNotesSchema.exactOptional(),
  frequency: recurringFrequencySchema,
  interval: intervalSchema.exactOptional(),
  startDate: scheduleDateSchema,
  endDate: scheduleDateSchema.exactOptional(),
  reminderDays: reminderDaysSchema.exactOptional(),
};

export const createRecurringScheduleInputSchema = z
  .strictObject({ ...scheduleInputShape, type: recurringTypeSchema })
  .superRefine(checkSchedule) satisfies z.ZodType<CreateRecurringScheduleInput>;

export const updateRecurringScheduleInputSchema = z
  .strictObject({
    name: scheduleNameSchema.exactOptional(),
    amountMinor: transactionAmountMinorSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
    accountId: entityIdSchema.nullable().exactOptional(),
    categoryId: entityIdSchema.nullable().exactOptional(),
    merchant: transactionMerchantSchema.nullable().exactOptional(),
    paymentMethod: paymentMethodSchema.nullable().exactOptional(),
    notes: transactionNotesSchema.nullable().exactOptional(),
    frequency: recurringFrequencySchema.exactOptional(),
    interval: intervalSchema.exactOptional(),
    startDate: scheduleDateSchema.exactOptional(),
    endDate: scheduleDateSchema.nullable().exactOptional(),
    reminderDays: reminderDaysSchema.nullable().exactOptional(),
  })
  .superRefine(checkSchedule)
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateRecurringScheduleInput>;

export const recordOccurrenceInputSchema = z.strictObject({
  accountId: entityIdSchema.exactOptional(),
  amountMinor: transactionAmountMinorSchema.exactOptional(),
  occurredAt: isoDateTimeSchema
    .refine((value) => value >= '1900-01-01', { error: 'Choose a date after 1900.' })
    .exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  description: transactionDescriptionSchema.exactOptional(),
  merchant: transactionMerchantSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
  notes: transactionNotesSchema.exactOptional(),
  tags: tagListSchema.exactOptional(),
}) satisfies z.ZodType<RecordOccurrenceInput>;

export const linkOccurrenceInputSchema = z.strictObject({
  transactionId: entityIdSchema,
}) satisfies z.ZodType<LinkOccurrenceInput>;

export const occurrenceLinkCandidatesDtoSchema = z.object({
  candidates: z.array(transactionListItemDtoSchema),
}) satisfies z.ZodType<OccurrenceLinkCandidatesDto>;

export const postponeOccurrenceInputSchema = z.strictObject({
  dueDate: scheduleDateSchema,
}) satisfies z.ZodType<PostponeOccurrenceInput>;

export const endRecurringScheduleInputSchema = z.strictObject({
  endDate: scheduleDateSchema.exactOptional(),
}) satisfies z.ZodType<EndRecurringScheduleInput>;

// --- Queries -------------------------------------------------------------------------------------

export const recurringListQuerySchema = z.strictObject({
  status: recurringStatusFilterSchema.default('current'),
  type: recurringTypeSchema.exactOptional(),
  subscription: booleanQuerySchema.exactOptional(),
}) satisfies z.ZodType<RecurringListQuery>;

export const upcomingOccurrencesQuerySchema = z
  .strictObject({
    from: scheduleDateSchema.exactOptional(),
    to: scheduleDateSchema.exactOptional(),
    type: recurringTypeSchema.exactOptional(),
    subscription: booleanQuerySchema.exactOptional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.to >= query.from, {
    error: 'The end date must be on or after the start date.',
    path: ['to'],
  }) satisfies z.ZodType<UpcomingOccurrencesQuery>;

// --- Responses -----------------------------------------------------------------------------------

export const recurringScheduleDtoSchema = z.object({
  id: entityIdSchema,
  userId: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.scheduleName),
  type: recurringTypeSchema,
  amountMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  accountId: entityIdSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  merchant: z.string().min(1).max(TEXT_LIMITS.transactionMerchant).exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
  notes: z.string().min(1).max(TEXT_LIMITS.transactionNotes).exactOptional(),
  frequency: recurringFrequencySchema,
  interval: z.number().int().min(1).max(52),
  startDate: isoDateSchema,
  endDate: isoDateSchema.exactOptional(),
  reminderDays: z.number().int().min(0).max(MAX_REMINDER_DAYS).exactOptional(),
  status: recurringScheduleStatusSchema,
  nextOccurrenceDate: isoDateSchema.exactOptional(),
  isSubscription: z.boolean(),
  pausedAt: isoDateTimeSchema.exactOptional(),
  cancelledAt: isoDateTimeSchema.exactOptional(),
  archivedAt: isoDateTimeSchema.exactOptional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<RecurringScheduleDto>;

export const occurrenceDtoSchema = z.object({
  scheduleId: entityIdSchema,
  scheduledDate: isoDateSchema,
  dueDate: isoDateSchema,
  status: occurrenceStatusSchema,
  postponed: z.boolean(),
  dueSoon: z.boolean(),
  amountMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  transactionId: entityIdSchema.exactOptional(),
  transactionStatus: transactionStatusSchema.exactOptional(),
  resolvedAt: isoDateTimeSchema.exactOptional(),
}) satisfies z.ZodType<OccurrenceDto>;

export const recurringScheduleItemDtoSchema = z.object({
  schedule: recurringScheduleDtoSchema,
  account: transactionAccountRefDtoSchema.exactOptional(),
  category: planningCategoryRefDtoSchema.exactOptional(),
  nextOccurrence: occurrenceDtoSchema.exactOptional(),
}) satisfies z.ZodType<RecurringScheduleItemDto>;

export const recurringScheduleListDtoSchema = z.object({
  today: isoDateSchema,
  schedules: z.array(recurringScheduleItemDtoSchema),
}) satisfies z.ZodType<RecurringScheduleListDto>;

export const recurringScheduleDetailDtoSchema = z.object({
  ...recurringScheduleItemDtoSchema.shape,
  today: isoDateSchema,
  upcoming: z.array(occurrenceDtoSchema),
  history: z.array(occurrenceDtoSchema),
}) satisfies z.ZodType<RecurringScheduleDetailDto>;

export const upcomingOccurrenceDtoSchema = z.object({
  occurrence: occurrenceDtoSchema,
  schedule: recurringScheduleDtoSchema,
  account: transactionAccountRefDtoSchema.exactOptional(),
  category: planningCategoryRefDtoSchema.exactOptional(),
}) satisfies z.ZodType<UpcomingOccurrenceDto>;

export const expectedTotalsDtoSchema = z.object({
  currency: currencyCodeSchema,
  expectedIncomeMinor: minorUnitsSchema,
  expectedExpenseMinor: minorUnitsSchema,
  incomeCount: z.number().int().nonnegative(),
  expenseCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ExpectedTotalsDto>;

export const upcomingOccurrencesDtoSchema = z.object({
  today: isoDateSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  items: z.array(upcomingOccurrenceDtoSchema),
  pendingTotals: z.array(expectedTotalsDtoSchema),
  overdueCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
}) satisfies z.ZodType<UpcomingOccurrencesDto>;

export const recordedOccurrenceDtoSchema = z.object({
  occurrence: occurrenceDtoSchema,
  transaction: transactionListItemDtoSchema,
  schedule: recurringScheduleItemDtoSchema,
}) satisfies z.ZodType<RecordedOccurrenceDto>;

export const occurrenceActionResultDtoSchema = z.object({
  occurrence: occurrenceDtoSchema,
  schedule: recurringScheduleItemDtoSchema,
}) satisfies z.ZodType<OccurrenceActionResultDto>;
