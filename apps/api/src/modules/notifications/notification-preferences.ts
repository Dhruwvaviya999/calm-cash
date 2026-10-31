import {
  DEFAULT_NOTIFICATION_CHANNELS,
  DEFAULT_REMINDER_LEAD_DAYS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_CATEGORY,
  NOTIFICATION_TYPES,
  reminderLeadDaysSchema,
  type NotificationCategory,
  type NotificationChannelsByCategoryDto,
  type NotificationChannelsDto,
  type NotificationType,
  type ReminderLeadDays,
  type UpdateNotificationPreferencesInput,
} from '@calmcash/shared';

import type { NotificationPreference } from '../../generated/prisma/client';

// A person's notification choices as one typed value, whether or not they ever saved a change
// (no row = the documented defaults). The API's settings endpoints and the worker read it the same
// way, so a preference means the same thing when it is shown and when it is applied.

export interface ResolvedPreferences {
  channels: NotificationChannelsByCategoryDto;
  paymentLeadDays: ReminderLeadDays;
  subscriptionLeadDays: ReminderLeadDays;
  includeRecurringIncome: boolean;
  /** Absent while the defaults apply. */
  updatedAt: Date | undefined;
}

/** The preference columns, without the key and timestamps. */
export type PreferenceColumns = Omit<NotificationPreference, 'userId' | 'createdAt' | 'updatedAt'>;

/** Column names of each category's channels. */
const COLUMNS: Readonly<
  Record<NotificationCategory, { inApp: keyof PreferenceColumns; email: keyof PreferenceColumns }>
> = {
  budget_alerts: { inApp: 'budgetAlertsInApp', email: 'budgetAlertsEmail' },
  upcoming_payments: { inApp: 'upcomingPaymentsInApp', email: 'upcomingPaymentsEmail' },
  overdue_payments: { inApp: 'overduePaymentsInApp', email: 'overduePaymentsEmail' },
  subscription_renewals: {
    inApp: 'subscriptionRenewalsInApp',
    email: 'subscriptionRenewalsEmail',
  },
  monthly_summary: { inApp: 'monthlySummaryInApp', email: 'monthlySummaryEmail' },
};

function leadDays(value: number): ReminderLeadDays {
  // The CHECK constraint keeps stored values valid; anything else falls back to the default.
  const parsed = reminderLeadDaysSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_REMINDER_LEAD_DAYS;
}

function booleanColumn(row: PreferenceColumns, column: keyof PreferenceColumns): boolean {
  const value = row[column];
  return typeof value === 'boolean' ? value : false;
}

export const DEFAULT_PREFERENCES: ResolvedPreferences = {
  channels: { ...DEFAULT_NOTIFICATION_CHANNELS },
  paymentLeadDays: DEFAULT_REMINDER_LEAD_DAYS,
  subscriptionLeadDays: DEFAULT_REMINDER_LEAD_DAYS,
  includeRecurringIncome: false,
  updatedAt: undefined,
};

export function resolvePreferences(row: NotificationPreference | null): ResolvedPreferences {
  if (row === null) {
    return DEFAULT_PREFERENCES;
  }
  const channelsOf = (category: NotificationCategory): NotificationChannelsDto => ({
    inApp: booleanColumn(row, COLUMNS[category].inApp),
    email: booleanColumn(row, COLUMNS[category].email),
  });
  return {
    channels: {
      budget_alerts: channelsOf('budget_alerts'),
      upcoming_payments: channelsOf('upcoming_payments'),
      overdue_payments: channelsOf('overdue_payments'),
      subscription_renewals: channelsOf('subscription_renewals'),
      monthly_summary: channelsOf('monthly_summary'),
    },
    paymentLeadDays: leadDays(row.paymentLeadDays),
    subscriptionLeadDays: leadDays(row.subscriptionLeadDays),
    includeRecurringIncome: row.includeRecurringIncome,
    updatedAt: row.updatedAt,
  };
}

/** The preferences after a change. Only the channels named in the patch change. */
export function applyPreferencePatch(
  current: ResolvedPreferences,
  patch: UpdateNotificationPreferencesInput,
): ResolvedPreferences {
  const channels = { ...current.channels };
  for (const category of NOTIFICATION_CATEGORIES) {
    const change = patch.channels?.[category];
    if (change !== undefined) {
      channels[category] = {
        inApp: change.inApp ?? channels[category].inApp,
        email: change.email ?? channels[category].email,
      };
    }
  }
  return {
    channels,
    paymentLeadDays: patch.paymentLeadDays ?? current.paymentLeadDays,
    subscriptionLeadDays: patch.subscriptionLeadDays ?? current.subscriptionLeadDays,
    includeRecurringIncome: patch.includeRecurringIncome ?? current.includeRecurringIncome,
    updatedAt: current.updatedAt,
  };
}

export function toPreferenceColumns(preferences: ResolvedPreferences): PreferenceColumns {
  const { channels } = preferences;
  return {
    budgetAlertsInApp: channels.budget_alerts.inApp,
    budgetAlertsEmail: channels.budget_alerts.email,
    upcomingPaymentsInApp: channels.upcoming_payments.inApp,
    upcomingPaymentsEmail: channels.upcoming_payments.email,
    overduePaymentsInApp: channels.overdue_payments.inApp,
    overduePaymentsEmail: channels.overdue_payments.email,
    subscriptionRenewalsInApp: channels.subscription_renewals.inApp,
    subscriptionRenewalsEmail: channels.subscription_renewals.email,
    monthlySummaryInApp: channels.monthly_summary.inApp,
    monthlySummaryEmail: channels.monthly_summary.email,
    paymentLeadDays: preferences.paymentLeadDays,
    subscriptionLeadDays: preferences.subscriptionLeadDays,
    includeRecurringIncome: preferences.includeRecurringIncome,
  };
}

/**
 * The channels a notification type goes to. Service notices (no category) are in-app only and
 * never e-mailed.
 */
export function channelsForType(
  preferences: ResolvedPreferences,
  type: NotificationType,
): NotificationChannelsDto {
  const category = NOTIFICATION_TYPE_CATEGORY[type];
  return category === null ? { inApp: true, email: false } : preferences.channels[category];
}

/** Categories whose e-mail was switched off by a change (their queued e-mails are suppressed). */
export function emailTurnedOff(
  before: ResolvedPreferences,
  after: ResolvedPreferences,
): NotificationCategory[] {
  return NOTIFICATION_CATEGORIES.filter(
    (category) => before.channels[category].email && !after.channels[category].email,
  );
}

/** Notification types of some categories. */
export function typesOf(categories: readonly NotificationCategory[]): NotificationType[] {
  return NOTIFICATION_TYPES.filter((type) => {
    const category = NOTIFICATION_TYPE_CATEGORY[type];
    return category !== null && categories.includes(category);
  });
}
