import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  daysBetween,
  MAX_UPCOMING_OCCURRENCES,
  REMINDER_LEAD_DAYS,
  startOfDayInTimeZone,
  type IsoDateString,
  type NotificationCategory,
  type NotificationType,
  type UpcomingOccurrenceDto,
} from '@calmcash/shared';

import type { ResolvedPreferences } from '../modules/notifications/notification-preferences';
import type { AutomationDomain, UserContext } from './domain';
import {
  dueReminderText,
  overdueReminderText,
  subscriptionReminderText,
  upcomingReminderText,
  type NotificationText,
  type ReminderFacts,
} from './notification-text';
import type { NotificationWriter } from './notification-writer';

// Reminders for recurring payments and subscriptions, from the Phase 7 recurrence engine (the
// recurring service's pending occurrences, in the user's calendar). A reminder says a payment is
// expected; it never records one, and only pending occurrences of active schedules qualify —
// recorded, skipped, paused, cancelled, archived, and ended ones never do.
//
// Rules (calendar days in the user's time zone; `L` = the person's lead time, 1, 3, or 7 days):
// - bills (and expected income, when chosen): "upcoming" while the due date is 1…L days away,
//   "due" on the due date, and "overdue" once, within 7 days after it;
// - subscriptions: one renewal reminder while the charge is 1…L days away — no due or overdue
//   reminders, so a subscription never also gets a bill reminder.
//
// Identities include the schedule, the occurrence (scheduled date), the due date, and for advance
// reminders the lead time. Postponing an occurrence is a new due date and so a new reminder;
// repeated reviews never duplicate one; and an advance reminder already sent with another lead
// time covers the same occurrence and due date, so changing the lead time does not repeat it. A
// review creates at most 25 new reminders, so a long-stopped worker cannot flood anyone.

export const OVERDUE_REMINDER_WINDOW_DAYS = 7;
export const MAX_REMINDERS_PER_REVIEW = 25;

/** Longest an overdue reminder e-mail may wait. */
const OVERDUE_EMAIL_MAX_DELAY_MS = 2 * 24 * 60 * 60 * 1000;

export type ReminderKind = 'upcoming' | 'due' | 'overdue' | 'subscription';

const KIND_TYPE: Readonly<Record<ReminderKind, NotificationType>> = {
  upcoming: 'recurring_payment_upcoming',
  due: 'recurring_payment_due',
  overdue: 'recurring_payment_overdue',
  subscription: 'subscription_renewal_upcoming',
};

const KIND_CATEGORY: Readonly<Record<ReminderKind, NotificationCategory>> = {
  upcoming: 'upcoming_payments',
  due: 'upcoming_payments',
  overdue: 'overdue_payments',
  subscription: 'subscription_renewals',
};

/** Created first when a review has more reminders than its cap: what needs attention soonest. */
const KIND_PRIORITY: Readonly<Record<ReminderKind, number>> = {
  due: 0,
  upcoming: 1,
  subscription: 1,
  overdue: 2,
};

export function reminderKey(
  kind: ReminderKind,
  occurrence: { scheduleId: string; scheduledDate: IsoDateString; dueDate: IsoDateString },
  leadDays: number,
): string {
  const base = `${occurrence.scheduleId}:${occurrence.scheduledDate}:${occurrence.dueDate}`;
  switch (kind) {
    case 'upcoming':
      return `recurring-upcoming:${base}:L${leadDays.toString()}`;
    case 'due':
      return `recurring-due:${base}`;
    case 'overdue':
      return `recurring-overdue:${base}`;
    case 'subscription':
      return `subscription-renewal:${base}:L${leadDays.toString()}`;
  }
}

export interface ReminderPlan {
  kind: ReminderKind;
  type: NotificationType;
  category: NotificationCategory;
  dedupeKey: string;
  /** This identity and any other that already told the person the same thing. */
  coveringKeys: string[];
  item: UpcomingOccurrenceDto;
}

function wanted(preferences: ResolvedPreferences, category: NotificationCategory): boolean {
  const channels = preferences.channels[category];
  return channels.inApp || channels.email;
}

function kindFor(
  item: UpcomingOccurrenceDto,
  today: IsoDateString,
  preferences: ResolvedPreferences,
): ReminderKind | undefined {
  const { occurrence, schedule } = item;
  if (schedule.status !== 'active') return undefined;
  if (schedule.type === 'income' && !preferences.includeRecurringIncome) return undefined;

  if (schedule.isSubscription) {
    if (schedule.cancelledAt !== undefined || occurrence.status !== 'upcoming') return undefined;
    return daysBetween(today, occurrence.dueDate) <= preferences.subscriptionLeadDays
      ? 'subscription'
      : undefined;
  }
  switch (occurrence.status) {
    case 'upcoming':
      return daysBetween(today, occurrence.dueDate) <= preferences.paymentLeadDays
        ? 'upcoming'
        : undefined;
    case 'due':
      return 'due';
    case 'overdue':
      // An old occurrence is not nagged about forever: one reminder, within a week of its date.
      return daysBetween(occurrence.dueDate, today) <= OVERDUE_REMINDER_WINDOW_DAYS
        ? 'overdue'
        : undefined;
    case 'recorded':
    case 'skipped':
    case 'paused':
      return undefined;
  }
}

/** Every reminder today's occurrences call for, most urgent first (before de-duplication). */
export function planReminders(
  items: readonly UpcomingOccurrenceDto[],
  today: IsoDateString,
  preferences: ResolvedPreferences,
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  for (const item of items) {
    const kind = kindFor(item, today, preferences);
    if (kind === undefined || !wanted(preferences, KIND_CATEGORY[kind])) continue;
    const lead =
      kind === 'subscription' ? preferences.subscriptionLeadDays : preferences.paymentLeadDays;
    const dedupeKey = reminderKey(kind, item.occurrence, lead);
    plans.push({
      kind,
      type: KIND_TYPE[kind],
      category: KIND_CATEGORY[kind],
      dedupeKey,
      coveringKeys:
        kind === 'upcoming' || kind === 'subscription'
          ? REMINDER_LEAD_DAYS.map((days) => reminderKey(kind, item.occurrence, days))
          : [dedupeKey],
      item,
    });
  }
  return plans.sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      (a.kind === 'overdue'
        ? b.item.occurrence.dueDate.localeCompare(a.item.occurrence.dueDate)
        : a.item.occurrence.dueDate.localeCompare(b.item.occurrence.dueDate)) ||
      a.dedupeKey.localeCompare(b.dedupeKey),
  );
}

function reminderText(plan: ReminderPlan, today: IsoDateString): NotificationText {
  const { occurrence, schedule } = plan.item;
  const facts: ReminderFacts = {
    name: schedule.name,
    type: schedule.type,
    amountMinor: BigInt(occurrence.amountMinor),
    currency: occurrence.currency,
    dueDate: occurrence.dueDate,
    today,
  };
  switch (plan.kind) {
    case 'upcoming':
      return upcomingReminderText(facts);
    case 'due':
      return dueReminderText(facts);
    case 'overdue':
      return overdueReminderText(facts);
    case 'subscription':
      return subscriptionReminderText(facts);
  }
}

/** After this instant the reminder's e-mail would be out of date. */
function emailExpiry(plan: ReminderPlan, timeZone: string, now: Date): Date {
  const due = plan.item.occurrence.dueDate;
  switch (plan.kind) {
    case 'upcoming':
    case 'subscription':
      return startOfDayInTimeZone(due, timeZone);
    case 'due':
      return startOfDayInTimeZone(addDaysToIsoDate(due, 1), timeZone);
    case 'overdue':
      return new Date(now.getTime() + OVERDUE_EMAIL_MAX_DELAY_MS);
  }
}

export interface ReminderContext {
  domain: AutomationDomain;
  writer: NotificationWriter;
}

/** Creates today's reminders for one user; returns how many were new. */
export async function sendReminders(
  { domain, writer }: ReminderContext,
  user: UserContext,
  now: Date,
): Promise<number> {
  const { preferences, caller } = user;
  const categories: NotificationCategory[] = [
    'upcoming_payments',
    'overdue_payments',
    'subscription_renewals',
  ];
  if (!categories.some((category) => wanted(preferences, category))) {
    return 0;
  }
  const today = calendarDateInTimeZone(now, caller.timeZone);
  const horizon = Math.max(preferences.paymentLeadDays, preferences.subscriptionLeadDays);
  const upcoming = await domain.recurring.collect(caller, {
    from: today,
    to: addDaysToIsoDate(today, horizon),
    limit: MAX_UPCOMING_OCCURRENCES,
  });
  const plans = planReminders(upcoming.items, today, preferences);
  const existing = await writer.existingKeys(
    caller.userId,
    plans.flatMap((plan) => plan.coveringKeys),
  );

  let created = 0;
  for (const plan of plans) {
    if (created >= MAX_REMINDERS_PER_REVIEW) break;
    if (plan.coveringKeys.some((key) => existing.has(key))) continue;
    const { occurrence, schedule } = plan.item;
    const outcome = await writer.write(
      {
        userId: caller.userId,
        type: plan.type,
        dedupeKey: plan.dedupeKey,
        ...reminderText(plan, today),
        target: {
          kind: schedule.isSubscription ? 'subscription' : 'recurring',
          scheduleId: schedule.id,
          scheduledDate: occurrence.scheduledDate,
          dueDate: occurrence.dueDate,
        },
        channels: preferences.channels[plan.category],
        emailExpiresAt: emailExpiry(plan, caller.timeZone, now),
      },
      user.emailVerified,
      now,
    );
    if (outcome === 'created') created += 1;
  }
  return created;
}
