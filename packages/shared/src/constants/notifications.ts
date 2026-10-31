// Notification taxonomy shared by the API (generation, delivery, preferences), the worker, and the
// web app (notification center, settings). Notifications describe financial events and reminders;
// they never record a transaction, move money, or claim that a scheduled payment happened.

/**
 * Every kind of notification CalmCash creates:
 *
 * - `budget_approaching_limit`: spending reached one of the budget's own alert thresholds (< 100 %).
 * - `budget_limit_reached`: spending reached (or passed) the budget's limit.
 * - `recurring_payment_upcoming`: an expected bill or income is due in a few days.
 * - `recurring_payment_due`: an expected bill or income is due today.
 * - `recurring_payment_overdue`: an expected bill or income passed its due date unrecorded.
 * - `subscription_renewal_upcoming`: a subscription is expected to renew in a few days.
 * - `monthly_summary_ready`: last month's income and spending summary is available.
 * - `email_delivery_problem`: a notification e-mail could not be delivered (an in-app notice).
 */
export const NOTIFICATION_TYPES = [
  'budget_approaching_limit',
  'budget_limit_reached',
  'recurring_payment_upcoming',
  'recurring_payment_due',
  'recurring_payment_overdue',
  'subscription_renewal_upcoming',
  'monthly_summary_ready',
  'email_delivery_problem',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** What a person can switch on or off, per channel, in Settings → Notifications. */
export const NOTIFICATION_CATEGORIES = [
  'budget_alerts',
  'upcoming_payments',
  'overdue_payments',
  'subscription_renewals',
  'monthly_summary',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * The preference category of each type. `null` marks service notices about CalmCash itself (such
 * as an e-mail that could not be delivered); they are shown in the app only and never e-mailed.
 */
export const NOTIFICATION_TYPE_CATEGORY: Readonly<
  Record<NotificationType, NotificationCategory | null>
> = {
  budget_approaching_limit: 'budget_alerts',
  budget_limit_reached: 'budget_alerts',
  recurring_payment_upcoming: 'upcoming_payments',
  recurring_payment_due: 'upcoming_payments',
  recurring_payment_overdue: 'overdue_payments',
  subscription_renewal_upcoming: 'subscription_renewals',
  monthly_summary_ready: 'monthly_summary',
  email_delivery_problem: null,
};

/** Push notifications and SMS are not part of CalmCash yet. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** How far ahead of a due date a reminder is sent. Only these values can be chosen. */
export const REMINDER_LEAD_DAYS = [1, 3, 7] as const;

export type ReminderLeadDays = (typeof REMINDER_LEAD_DAYS)[number];

export const DEFAULT_REMINDER_LEAD_DAYS: ReminderLeadDays = 3;

export interface NotificationCategoryDefaults {
  inApp: boolean;
  email: boolean;
}

/**
 * Safe defaults for someone who never opened the notification settings: reminders and alerts in
 * the app, nothing by e-mail until they opt in.
 */
export const DEFAULT_NOTIFICATION_CHANNELS: Readonly<
  Record<NotificationCategory, NotificationCategoryDefaults>
> = {
  budget_alerts: { inApp: true, email: false },
  upcoming_payments: { inApp: true, email: false },
  overdue_payments: { inApp: true, email: false },
  subscription_renewals: { inApp: true, email: false },
  monthly_summary: { inApp: true, email: false },
};

/** Status filter of the notification list. */
export const NOTIFICATION_LIST_FILTERS = ['all', 'unread'] as const;

export type NotificationListFilter = (typeof NOTIFICATION_LIST_FILTERS)[number];

export const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
export const MAX_NOTIFICATION_PAGE_SIZE = 50;

/** Most notifications one bulk "mark as read" request may name. */
export const MAX_NOTIFICATION_BULK_IDS = 100;

/** Text bounds of a stored notification (plain text; never markup). */
export const NOTIFICATION_TEXT_LIMITS = {
  title: 160,
  body: 1000,
} as const;

// --- Delivery and automation (worker-facing) -----------------------------------------------------

/**
 * Where one e-mail delivery stands. Independent of the in-app read state.
 *
 * - `pending`: waiting for its first attempt.
 * - `processing`: a worker holds its lease and is talking to the mail server.
 * - `sent`: the mail server accepted the message.
 * - `retry_scheduled`: an attempt failed in a way worth retrying; `next_attempt_at` says when.
 * - `failed`: given up (permanent error, attempts exhausted, or expired while retrying).
 * - `suppressed`: deliberately not sent (preference turned off, address unverified, reminder no
 *   longer relevant, or expired before its first attempt).
 */
export const NOTIFICATION_DELIVERY_STATUSES = [
  'pending',
  'processing',
  'sent',
  'retry_scheduled',
  'failed',
  'suppressed',
] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/** Channels that have delivery records (in-app notifications need none). */
export const DELIVERY_CHANNELS = ['email'] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** Where one automation job stands. */
export const AUTOMATION_JOB_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;

export type AutomationJobStatus = (typeof AUTOMATION_JOB_STATUSES)[number];

/**
 * Work the worker performs:
 *
 * - `budget_evaluation`: re-check one user's budgets after spending or a budget changed.
 * - `daily_review`: one user's reminders, monthly summary, and budget check for one local day.
 * - `maintenance`: retention clean-up of old notifications, deliveries, and jobs.
 */
export const AUTOMATION_JOB_KINDS = ['budget_evaluation', 'daily_review', 'maintenance'] as const;

export type AutomationJobKind = (typeof AUTOMATION_JOB_KINDS)[number];
