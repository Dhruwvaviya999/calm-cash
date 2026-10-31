import {
  calendarDateInTimeZone,
  type MonthlySummaryDto,
  type NotificationTargetDto,
  type NotificationType,
} from '@calmcash/shared';

import type { PrismaClient } from '../generated/prisma/client';
import { AppError } from '../lib/app-error';
import { EmailDeliveryError, type EmailService } from '../lib/email';
import type { Logger } from '../lib/logger';
import { channelsForType } from '../modules/notifications/notification-preferences';
import { readTarget } from '../modules/notifications/notifications.mapper';
import type { ClaimedDelivery, DeliveryStore } from './delivery-store';
import { loadUserContext, type AutomationDomain, type UserContext } from './domain';
import { buildMonthlySummary } from './monthly-summary';
import { renderNotificationEmail } from './notification-emails';
import { deliveryProblemText } from './notification-text';
import type { NotificationWriter } from './notification-writer';
import { decideRetry, DELIVERY_RETRY_POLICY } from './retry-policy';

// Sends one claimed e-mail delivery. Before every attempt it re-checks, from authoritative data,
// that the e-mail is still wanted and still true: the address is verified, the person still has
// e-mail on for this type, the delivery has not expired, and the subject is unchanged (the budget
// still active in that period; the occurrence still pending, on the same due date, of an active
// schedule). Otherwise the delivery is suppressed, never sent late or out of date.
//
// Delivery is at least once, not exactly once: when the connection fails at a point where the
// server may already have accepted the message, the attempt is recorded as uncertain and retried
// with the same Message-ID, so a duplicate is possible but a silent loss is not.

export interface DeliveryContext {
  prisma: PrismaClient;
  domain: AutomationDomain;
  deliveries: DeliveryStore;
  writer: NotificationWriter;
  email: EmailService;
  logger: Logger;
  webAppUrl: string;
  workerId: string;
}

export type DeliveryOutcome = 'sent' | 'retry_scheduled' | 'failed' | 'suppressed' | 'lease_lost';

type Relevance = { relevant: true } | { relevant: false; reason: string };

const RELEVANT: Relevance = { relevant: true };
const stale = (reason: string): Relevance => ({ relevant: false, reason });

async function budgetRelevance(
  domain: AutomationDomain,
  user: UserContext,
  target: NotificationTargetDto,
  today: string,
): Promise<Relevance> {
  if (target.kind !== 'budget') return stale('target_mismatch');
  try {
    const item = await domain.budgets.get(user.caller, target.budgetId, { date: today });
    if (item.budget.status !== 'active') return stale('budget_archived');
    if (item.progress.from !== target.periodFrom) return stale('period_ended');
    return RELEVANT;
  } catch (error: unknown) {
    if (error instanceof AppError && error.statusCode === 404) return stale('budget_missing');
    throw error;
  }
}

const EXPECTED_STATUS: Partial<Record<NotificationType, 'upcoming' | 'due' | 'overdue'>> = {
  recurring_payment_upcoming: 'upcoming',
  subscription_renewal_upcoming: 'upcoming',
  recurring_payment_due: 'due',
  recurring_payment_overdue: 'overdue',
};

async function occurrenceRelevance(
  domain: AutomationDomain,
  user: UserContext,
  type: NotificationType,
  target: NotificationTargetDto,
): Promise<Relevance> {
  if (target.kind !== 'recurring' && target.kind !== 'subscription')
    return stale('target_mismatch');
  const found = await domain.recurring.occurrence(user.caller, {
    scheduleId: target.scheduleId,
    date: target.scheduledDate,
  });
  if (found === undefined) return stale('occurrence_missing');
  const { schedule } = found.schedule;
  if (schedule.status !== 'active') return stale('schedule_inactive');
  if (schedule.cancelledAt !== undefined) return stale('subscription_cancelled');
  const { occurrence } = found;
  if (
    occurrence.status === 'recorded' ||
    occurrence.status === 'skipped' ||
    occurrence.status === 'paused'
  ) {
    return stale('occurrence_resolved');
  }
  if (occurrence.dueDate !== target.dueDate) return stale('occurrence_rescheduled');
  if (EXPECTED_STATUS[type] !== occurrence.status) return stale('no_longer_current');
  return RELEVANT;
}

async function relevanceOf(
  domain: AutomationDomain,
  user: UserContext,
  type: NotificationType,
  target: NotificationTargetDto | undefined,
  now: Date,
): Promise<Relevance> {
  const today = calendarDateInTimeZone(now, user.caller.timeZone);
  switch (type) {
    case 'budget_approaching_limit':
    case 'budget_limit_reached':
      return target === undefined
        ? stale('target_missing')
        : budgetRelevance(domain, user, target, today);
    case 'recurring_payment_upcoming':
    case 'recurring_payment_due':
    case 'recurring_payment_overdue':
    case 'subscription_renewal_upcoming':
      return target === undefined
        ? stale('target_missing')
        : occurrenceRelevance(domain, user, type, target);
    case 'monthly_summary_ready':
      return target?.kind === 'dashboard' ? RELEVANT : stale('target_missing');
    case 'email_delivery_problem':
      return stale('in_app_only');
  }
}

/** One in-app notice per day when notification e-mail keeps failing permanently. */
async function noteDeliveryProblem(ctx: DeliveryContext, userId: string, now: Date): Promise<void> {
  await ctx.writer.write(
    {
      userId,
      type: 'email_delivery_problem',
      dedupeKey: `delivery-problem:${now.toISOString().slice(0, 10)}`,
      ...deliveryProblemText(),
      target: { kind: 'notification_settings' },
      channels: { inApp: true, email: false },
      emailExpiresAt: undefined,
    },
    false,
    now,
  );
}

/** A stable Message-ID for the delivery, so retries are recognisable as the same message. */
export function deliveryMessageId(deliveryId: string, webAppUrl: string): string {
  return `${deliveryId}.notification@${new URL(webAppUrl).hostname}`;
}

export async function processDelivery(
  ctx: DeliveryContext,
  delivery: ClaimedDelivery,
  now: Date,
): Promise<DeliveryOutcome> {
  const { deliveries, workerId } = ctx;
  const suppress = async (reason: string): Promise<DeliveryOutcome> =>
    (await deliveries.markSuppressed(delivery.id, workerId, reason, now))
      ? 'suppressed'
      : 'lease_lost';

  const notification = await ctx.prisma.notification.findUnique({
    where: { id: delivery.notificationId },
  });
  if (notification === null) return suppress('notification_missing');
  const user = await loadUserContext(ctx.prisma, notification.userId);
  if (user === undefined) return suppress('user_missing');
  if (!user.emailVerified) return suppress('email_unverified');
  if (!channelsForType(user.preferences, notification.type).email) {
    return suppress('preference_off');
  }
  if (delivery.expiresAt !== null && delivery.expiresAt <= now) return suppress('expired');

  const target = readTarget(notification.target);
  const relevance = await relevanceOf(ctx.domain, user, notification.type, target, now);
  if (!relevance.relevant) return suppress(relevance.reason);

  // A summary e-mail carries the month's figures, recomputed now from the ledger.
  let summary: MonthlySummaryDto | undefined;
  if (notification.type === 'monthly_summary_ready' && target?.kind === 'dashboard') {
    summary = await buildMonthlySummary(
      ctx.domain,
      user.caller,
      { month: target.from.slice(0, 7), from: target.from, to: target.to },
      target.currency,
      calendarDateInTimeZone(now, user.caller.timeZone),
    );
    if (summary === undefined) return suppress('summary_unavailable');
  }

  const message = renderNotificationEmail({
    to: user.email,
    recipientName: user.name,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    target,
    summary,
    messageId: deliveryMessageId(delivery.id, ctx.webAppUrl),
    webAppUrl: ctx.webAppUrl,
  });

  try {
    await ctx.email.send(message);
  } catch (error: unknown) {
    const failure =
      error instanceof EmailDeliveryError
        ? { kind: error.kind, code: error.code }
        : { kind: 'retryable' as const, code: 'internal' };
    const uncertain = failure.kind === 'ambiguous';
    if (failure.kind !== 'permanent') {
      const decision = decideRetry(DELIVERY_RETRY_POLICY, delivery, now);
      if (decision.action === 'retry') {
        return (await deliveries.scheduleRetry(
          delivery.id,
          workerId,
          { at: decision.at, errorCode: failure.code, uncertain },
          now,
        ))
          ? 'retry_scheduled'
          : 'lease_lost';
      }
    }
    const failed = await deliveries.markFailed(
      delivery.id,
      workerId,
      { errorCode: failure.code, uncertain },
      now,
    );
    if (!failed) return 'lease_lost';
    await noteDeliveryProblem(ctx, notification.userId, now);
    return 'failed';
  }
  return (await deliveries.markSent(delivery.id, workerId, now)) ? 'sent' : 'lease_lost';
}
