import { z } from 'zod';

import {
  AUTOMATION_JOB_KINDS,
  AUTOMATION_JOB_STATUSES,
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_BULK_IDS,
  MAX_NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_LIST_FILTERS,
  NOTIFICATION_TEXT_LIMITS,
  NOTIFICATION_TYPES,
  REMINDER_LEAD_DAYS,
} from '../constants/notifications';
import type {
  AutomationStatusDto,
  MarkNotificationsReadInput,
  MonthlySummaryDto,
  NotificationChannelsByCategoryDto,
  NotificationChannelsByCategoryPatch,
  NotificationChannelsDto,
  NotificationChannelsPatch,
  NotificationDto,
  NotificationListQuery,
  NotificationPageDto,
  NotificationPreferencesDto,
  NotificationsUpdatedDto,
  NotificationTargetDto,
  UnreadNotificationCountDto,
  UpdateNotificationPreferencesInput,
} from '../types/notification';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
} from './common';
import { ratioDtoSchema } from './dashboard';
import { paginationDtoSchema } from './transaction';

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export const notificationListFilterSchema = z.enum(NOTIFICATION_LIST_FILTERS);
export const notificationDeliveryStatusSchema = z.enum(NOTIFICATION_DELIVERY_STATUSES);
export const automationJobStatusSchema = z.enum(AUTOMATION_JOB_STATUSES);
export const automationJobKindSchema = z.enum(AUTOMATION_JOB_KINDS);

export const reminderLeadDaysSchema = z.literal(REMINDER_LEAD_DAYS, {
  error: `Choose ${REMINDER_LEAD_DAYS.join(', ')} days.`,
});

// --- Targets -------------------------------------------------------------------------------------

export const notificationTargetDtoSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('budget'),
    budgetId: entityIdSchema,
    periodFrom: isoDateSchema,
  }),
  z.strictObject({
    kind: z.enum(['recurring', 'subscription']),
    scheduleId: entityIdSchema,
    scheduledDate: isoDateSchema,
    dueDate: isoDateSchema,
  }),
  z.strictObject({
    kind: z.literal('dashboard'),
    from: isoDateSchema,
    to: isoDateSchema,
    currency: currencyCodeSchema,
  }),
  z.strictObject({ kind: z.literal('notification_settings') }),
]) satisfies z.ZodType<NotificationTargetDto>;

// --- Notifications -------------------------------------------------------------------------------

export const notificationDtoSchema = z.object({
  id: entityIdSchema,
  type: notificationTypeSchema,
  category: notificationCategorySchema.exactOptional(),
  title: z.string().min(1).max(NOTIFICATION_TEXT_LIMITS.title),
  body: z.string().max(NOTIFICATION_TEXT_LIMITS.body),
  target: notificationTargetDtoSchema.exactOptional(),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.exactOptional(),
}) satisfies z.ZodType<NotificationDto>;

export const notificationPageDtoSchema = z.object({
  items: z.array(notificationDtoSchema),
  pagination: paginationDtoSchema,
  unreadCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<NotificationPageDto>;

export const unreadNotificationCountDtoSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<UnreadNotificationCountDto>;

export const notificationsUpdatedDtoSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<NotificationsUpdatedDto>;

function positiveIntegerQuery(max: number): z.ZodType<number, string> {
  return z
    .string()
    .regex(/^[1-9]\d{0,5}$/, { error: 'Must be a positive whole number.' })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .max(max, { error: `Must be at most ${max}.` }),
    );
}

export const notificationListQuerySchema = z.strictObject({
  status: notificationListFilterSchema.default('all'),
  page: positiveIntegerQuery(10_000).default(1),
  pageSize: positiveIntegerQuery(MAX_NOTIFICATION_PAGE_SIZE).default(
    DEFAULT_NOTIFICATION_PAGE_SIZE,
  ),
}) satisfies z.ZodType<NotificationListQuery>;

export const markNotificationsReadInputSchema = z.strictObject({
  ids: z
    .array(entityIdSchema)
    .min(1, { error: 'Choose at least one notification.' })
    .max(MAX_NOTIFICATION_BULK_IDS, {
      error: `Choose at most ${MAX_NOTIFICATION_BULK_IDS} notifications at a time.`,
    }),
}) satisfies z.ZodType<MarkNotificationsReadInput>;

// --- Preferences ---------------------------------------------------------------------------------

export const notificationChannelsDtoSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
}) satisfies z.ZodType<NotificationChannelsDto>;

export const notificationChannelsByCategoryDtoSchema = z.object({
  budget_alerts: notificationChannelsDtoSchema,
  upcoming_payments: notificationChannelsDtoSchema,
  overdue_payments: notificationChannelsDtoSchema,
  subscription_renewals: notificationChannelsDtoSchema,
  monthly_summary: notificationChannelsDtoSchema,
}) satisfies z.ZodType<NotificationChannelsByCategoryDto>;

const notificationChannelsPatchSchema = z
  .strictObject({
    inApp: z.boolean().exactOptional(),
    email: z.boolean().exactOptional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'Choose in-app, e-mail, or both.',
  }) satisfies z.ZodType<NotificationChannelsPatch>;

const notificationChannelsByCategoryPatchSchema = z
  .strictObject({
    budget_alerts: notificationChannelsPatchSchema.exactOptional(),
    upcoming_payments: notificationChannelsPatchSchema.exactOptional(),
    overdue_payments: notificationChannelsPatchSchema.exactOptional(),
    subscription_renewals: notificationChannelsPatchSchema.exactOptional(),
    monthly_summary: notificationChannelsPatchSchema.exactOptional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'Choose at least one notification category.',
  }) satisfies z.ZodType<NotificationChannelsByCategoryPatch>;

export const automationStatusDtoSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('running'), lastSeenAt: isoDateTimeSchema }),
  z.object({ status: z.literal('not_running'), lastSeenAt: isoDateTimeSchema.exactOptional() }),
]) satisfies z.ZodType<AutomationStatusDto>;

export const notificationPreferencesDtoSchema = z.object({
  channels: notificationChannelsByCategoryDtoSchema,
  paymentLeadDays: reminderLeadDaysSchema,
  subscriptionLeadDays: reminderLeadDaysSchema,
  includeRecurringIncome: z.boolean(),
  email: z.object({ address: z.email(), verified: z.boolean() }),
  automation: automationStatusDtoSchema,
  updatedAt: isoDateTimeSchema.exactOptional(),
}) satisfies z.ZodType<NotificationPreferencesDto>;

export const updateNotificationPreferencesInputSchema = z
  .strictObject({
    channels: notificationChannelsByCategoryPatchSchema.exactOptional(),
    paymentLeadDays: reminderLeadDaysSchema.exactOptional(),
    subscriptionLeadDays: reminderLeadDaysSchema.exactOptional(),
    includeRecurringIncome: z.boolean().exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one preference to change.',
  }) satisfies z.ZodType<UpdateNotificationPreferencesInput>;

// --- Monthly summary -----------------------------------------------------------------------------

const countSchema = z.number().int().nonnegative();

export const monthlySummaryDtoSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  from: isoDateSchema,
  to: isoDateSchema,
  currency: currencyCodeSchema,
  incomeMinor: minorUnitsSchema,
  expenseMinor: minorUnitsSchema,
  netMinor: minorUnitsSchema,
  incomeCount: countSchema,
  expenseCount: countSchema,
  savingsRate: ratioDtoSchema,
  topCategories: z.array(
    z.object({
      name: z.string().min(1),
      amountMinor: minorUnitsSchema,
      shareBasisPoints: z.string().regex(/^\d+$/),
    }),
  ),
  budgets: z.object({
    total: countSchema,
    overBudget: countSchema,
    limitReached: countSchema,
    approachingLimit: countSchema,
    onTrack: countSchema,
  }),
  upcoming: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    expectedExpenseMinor: minorUnitsSchema,
    expenseCount: countSchema,
  }),
}) satisfies z.ZodType<MonthlySummaryDto>;

// --- Automation job payloads (worker-facing) -----------------------------------------------------

// Every payload carries a version. A worker validates each claimed job against these schemas and
// marks a job it cannot read as failed (`invalid_payload`) instead of crashing, so a job written by
// a newer or older deployment can never stop the worker. Payloads hold identifiers and dates only;
// financial figures are recomputed from the ledger when the job runs.

export const budgetEvaluationPayloadSchema = z.strictObject({ v: z.literal(1) });

export const dailyReviewPayloadSchema = z.strictObject({
  v: z.literal(1),
  /** The user's calendar day this review is for. */
  localDate: isoDateSchema,
});

export const maintenancePayloadSchema = z.strictObject({
  v: z.literal(1),
  /** UTC calendar day of the run (one per day). */
  date: isoDateSchema,
});

export type BudgetEvaluationPayload = z.output<typeof budgetEvaluationPayloadSchema>;
export type DailyReviewPayload = z.output<typeof dailyReviewPayloadSchema>;
export type MaintenancePayload = z.output<typeof maintenancePayloadSchema>;

/** A claimed job as the worker handles it: its kind decides how the payload is read. */
export type AutomationJobPayload =
  | { kind: 'budget_evaluation'; payload: BudgetEvaluationPayload }
  | { kind: 'daily_review'; payload: DailyReviewPayload }
  | { kind: 'maintenance'; payload: MaintenancePayload };

export const automationJobPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('budget_evaluation'), payload: budgetEvaluationPayloadSchema }),
  z.object({ kind: z.literal('daily_review'), payload: dailyReviewPayloadSchema }),
  z.object({ kind: z.literal('maintenance'), payload: maintenancePayloadSchema }),
]) satisfies z.ZodType<AutomationJobPayload>;
