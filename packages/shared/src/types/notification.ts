import type { CurrencyCode } from '../constants/currencies';
import type {
  NotificationCategory,
  NotificationListFilter,
  NotificationType,
  ReminderLeadDays,
} from '../constants/notifications';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';
import type { RatioDto } from './dashboard';
import type { PaginationDto } from './transaction';

// In-app notifications and notification preferences. A notification is plain text written by the
// API (never markup) plus an optional navigation target made of identifiers only; the web app
// builds the link itself, so a stored notification can never point outside CalmCash.

// --- Navigation targets --------------------------------------------------------------------------

export interface BudgetNotificationTargetDto {
  kind: 'budget';
  budgetId: EntityId;
  /** First day of the budget period the alert is about. */
  periodFrom: IsoDateString;
}

export interface OccurrenceNotificationTargetDto {
  /** `subscription` for subscriptions, `recurring` for every other schedule. */
  kind: 'recurring' | 'subscription';
  scheduleId: EntityId;
  /** The occurrence's identity within its schedule. */
  scheduledDate: IsoDateString;
  /** When it was expected at the time of the reminder (later than `scheduledDate` if postponed). */
  dueDate: IsoDateString;
}

export interface DashboardNotificationTargetDto {
  kind: 'dashboard';
  from: IsoDateString;
  to: IsoDateString;
  currency: CurrencyCode;
}

export interface SettingsNotificationTargetDto {
  kind: 'notification_settings';
}

/** Where a notification leads. Identifiers only — never a URL. */
export type NotificationTargetDto =
  | BudgetNotificationTargetDto
  | OccurrenceNotificationTargetDto
  | DashboardNotificationTargetDto
  | SettingsNotificationTargetDto;

// --- Notifications -------------------------------------------------------------------------------

export interface NotificationDto {
  id: EntityId;
  type: NotificationType;
  /** The preference category; absent for service notices. */
  category?: NotificationCategory;
  /** Plain text. */
  title: string;
  /** Plain text. */
  body: string;
  target?: NotificationTargetDto;
  createdAt: IsoDateTimeString;
  /** Absent while unread. */
  readAt?: IsoDateTimeString;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  pagination: PaginationDto;
  /** Unread notifications in the center, whatever the filter. */
  unreadCount: number;
}

export interface NotificationListQuery {
  status: NotificationListFilter;
  page: number;
  pageSize: number;
}

export interface UnreadNotificationCountDto {
  unreadCount: number;
}

export interface MarkNotificationsReadInput {
  ids: EntityId[];
}

export interface NotificationsUpdatedDto {
  /** Notifications whose state changed (already-read ones are not counted). */
  updatedCount: number;
  unreadCount: number;
}

// --- Preferences ---------------------------------------------------------------------------------

export interface NotificationChannelsDto {
  /** Shown in the notification center. */
  inApp: boolean;
  /** Sent by e-mail (only to a verified address). */
  email: boolean;
}

export interface NotificationChannelsPatch {
  inApp?: boolean;
  email?: boolean;
}

export interface NotificationChannelsByCategoryDto {
  budget_alerts: NotificationChannelsDto;
  upcoming_payments: NotificationChannelsDto;
  overdue_payments: NotificationChannelsDto;
  subscription_renewals: NotificationChannelsDto;
  monthly_summary: NotificationChannelsDto;
}

export interface NotificationChannelsByCategoryPatch {
  budget_alerts?: NotificationChannelsPatch;
  upcoming_payments?: NotificationChannelsPatch;
  overdue_payments?: NotificationChannelsPatch;
  subscription_renewals?: NotificationChannelsPatch;
  monthly_summary?: NotificationChannelsPatch;
}

/**
 * Whether CalmCash's background worker — which creates reminders and sends e-mail — has checked
 * in recently. Without it, nothing new is generated or sent.
 */
export type AutomationStatusDto =
  | { status: 'running'; lastSeenAt: IsoDateTimeString }
  | { status: 'not_running'; lastSeenAt?: IsoDateTimeString };

export interface NotificationPreferencesDto {
  channels: NotificationChannelsByCategoryDto;
  /** Days before a bill or expected income is due that its reminder is sent. */
  paymentLeadDays: ReminderLeadDays;
  /** Days before a subscription renews that its reminder is sent. */
  subscriptionLeadDays: ReminderLeadDays;
  /** Also remind about expected income, not only bills. */
  includeRecurringIncome: boolean;
  email: { address: string; verified: boolean };
  automation: AutomationStatusDto;
  /** Absent until the person saves a change (the defaults apply until then). */
  updatedAt?: IsoDateTimeString;
}

/** Partial; at least one field. */
export interface UpdateNotificationPreferencesInput {
  channels?: NotificationChannelsByCategoryPatch;
  paymentLeadDays?: ReminderLeadDays;
  subscriptionLeadDays?: ReminderLeadDays;
  includeRecurringIncome?: boolean;
}

// --- Monthly summary -----------------------------------------------------------------------------

export interface MonthlySummaryCategoryDto {
  name: string;
  amountMinor: MinorUnitsString;
  shareBasisPoints: string;
}

/**
 * The deterministic summary of one completed calendar month in one currency, built from the
 * dashboard analytics (actual transactions only) and, kept apart, the payments still expected.
 */
export interface MonthlySummaryDto {
  /** `YYYY-MM`. */
  month: string;
  from: IsoDateString;
  to: IsoDateString;
  currency: CurrencyCode;
  incomeMinor: MinorUnitsString;
  expenseMinor: MinorUnitsString;
  netMinor: MinorUnitsString;
  incomeCount: number;
  expenseCount: number;
  savingsRate: RatioDto;
  /** Leading expense categories of the month (named categories only). */
  topCategories: MonthlySummaryCategoryDto[];
  /** Monthly budgets in this currency for that month. */
  budgets: {
    total: number;
    overBudget: number;
    limitReached: number;
    approachingLimit: number;
    onTrack: number;
  };
  /** Payments still expected after the summary was made: plans, not money that moved. */
  upcoming: {
    from: IsoDateString;
    to: IsoDateString;
    expectedExpenseMinor: MinorUnitsString;
    expenseCount: number;
  };
}
