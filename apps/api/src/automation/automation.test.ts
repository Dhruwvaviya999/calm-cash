import type {
  RecurringScheduleDto,
  UpcomingOccurrenceDto,
  OccurrenceStatus,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES, type ResolvedPreferences } from '../modules/notifications';
import { alertLevels, budgetAlertKey, reachedLevel } from './budget-alerts';
import { summaryPeriodFor } from './monthly-summary';
import { renderNotificationEmail } from './notification-emails';
import {
  budgetAlertText,
  formatBasisPoints,
  formatMoney,
  subscriptionReminderText,
  upcomingReminderText,
} from './notification-text';
import { MAX_REMINDERS_PER_REVIEW, planReminders, reminderKey } from './reminders';
import { decideRetry, DELIVERY_RETRY_POLICY, JOB_RETRY_POLICY, retryDelayMs } from './retry-policy';
import { dailyReviewJob } from './scheduler';

const ID = '01928c7e-4a5b-7c3d-8e9f-0a1b2c3d4e5f';

function item(
  overrides: {
    status?: OccurrenceStatus;
    dueDate?: string;
    scheduledDate?: string;
    schedule?: Partial<RecurringScheduleDto>;
  } = {},
): UpcomingOccurrenceDto {
  const dueDate = overrides.dueDate ?? '2026-02-28';
  return {
    occurrence: {
      scheduleId: ID,
      scheduledDate: overrides.scheduledDate ?? dueDate,
      dueDate,
      status: overrides.status ?? 'upcoming',
      postponed: false,
      dueSoon: false,
      amountMinor: '250000',
      currency: 'INR',
    },
    schedule: {
      id: ID,
      userId: ID,
      name: 'Rent',
      type: 'expense',
      amountMinor: '250000',
      currency: 'INR',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-31',
      status: 'active',
      isSubscription: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides.schedule,
    },
  };
}

const prefs = (overrides: Partial<ResolvedPreferences> = {}): ResolvedPreferences => ({
  ...DEFAULT_PREFERENCES,
  ...overrides,
});

describe('reminder planning', () => {
  it('reminds within the lead time of a month-end due date, not before', () => {
    // A schedule anchored on 31 January falls on 28 February (the recurrence engine's rule).
    const due = item({ dueDate: '2026-02-28' });
    expect(planReminders([due], '2026-02-24', prefs())).toEqual([]); // 4 days ahead
    const [plan] = planReminders([due], '2026-02-25', prefs()); // 3 days ahead
    expect(plan).toMatchObject({
      kind: 'upcoming',
      type: 'recurring_payment_upcoming',
      dedupeKey: `recurring-upcoming:${ID}:2026-02-28:2026-02-28:L3`,
    });
    // Every lead time's identity covers the same occurrence, so changing it does not repeat it.
    expect(plan?.coveringKeys).toEqual([
      `recurring-upcoming:${ID}:2026-02-28:2026-02-28:L1`,
      `recurring-upcoming:${ID}:2026-02-28:2026-02-28:L3`,
      `recurring-upcoming:${ID}:2026-02-28:2026-02-28:L7`,
    ]);
    expect(planReminders([due], '2026-02-27', prefs({ paymentLeadDays: 1 }))).toHaveLength(1);
    expect(planReminders([due], '2026-02-25', prefs({ paymentLeadDays: 1 }))).toEqual([]);
  });

  it('reminds on the due date, and once about overdue ones within a week', () => {
    expect(
      planReminders([item({ status: 'due', dueDate: '2026-03-01' })], '2026-03-01', prefs()),
    ).toMatchObject([{ kind: 'due', dedupeKey: `recurring-due:${ID}:2026-03-01:2026-03-01` }]);
    const overdue = (days: string): UpcomingOccurrenceDto =>
      item({ status: 'overdue', dueDate: days });
    expect(planReminders([overdue('2026-03-01')], '2026-03-08', prefs())).toHaveLength(1);
    expect(planReminders([overdue('2026-03-01')], '2026-03-09', prefs())).toEqual([]);
  });

  it('includes a postponed due date in the identity', () => {
    const key = reminderKey(
      'upcoming',
      { scheduleId: ID, scheduledDate: '2026-03-01', dueDate: '2026-03-05' },
      3,
    );
    expect(key).toBe(`recurring-upcoming:${ID}:2026-03-01:2026-03-05:L3`);
  });

  it('never reminds about resolved occurrences, inactive schedules, or unwanted categories', () => {
    for (const status of ['recorded', 'skipped', 'paused'] as const) {
      expect(planReminders([item({ status })], '2026-02-27', prefs())).toEqual([]);
    }
    expect(
      planReminders([item({ schedule: { status: 'paused' } })], '2026-02-27', prefs()),
    ).toEqual([]);
    const income = item({ schedule: { type: 'income' } });
    expect(planReminders([income], '2026-02-27', prefs())).toEqual([]);
    expect(
      planReminders([income], '2026-02-27', prefs({ includeRecurringIncome: true })),
    ).toHaveLength(1);
    const off = prefs({
      channels: {
        ...DEFAULT_PREFERENCES.channels,
        upcoming_payments: { inApp: false, email: false },
      },
    });
    expect(planReminders([item()], '2026-02-27', off)).toEqual([]);
  });

  it('gives subscriptions their renewal reminder only — never a bill reminder too', () => {
    const subscription = { isSubscription: true, name: 'Netflix' };
    expect(planReminders([item({ schedule: subscription })], '2026-02-25', prefs())).toMatchObject([
      { kind: 'subscription', type: 'subscription_renewal_upcoming' },
    ]);
    for (const status of ['due', 'overdue'] as const) {
      expect(
        planReminders([item({ status, schedule: subscription })], '2026-02-28', prefs()),
      ).toEqual([]);
    }
    expect(
      planReminders(
        [item({ schedule: { ...subscription, cancelledAt: '2026-02-20T00:00:00.000Z' } })],
        '2026-02-25',
        prefs(),
      ),
    ).toEqual([]);
  });

  it('puts what is due first and caps how much one review creates', () => {
    const plans = planReminders(
      [
        item({ status: 'overdue', dueDate: '2026-02-26', scheduledDate: '2026-02-26' }),
        item({ status: 'due', dueDate: '2026-02-28', scheduledDate: '2026-02-28' }),
        item({ dueDate: '2026-03-02', scheduledDate: '2026-03-02' }),
      ],
      '2026-02-28',
      prefs(),
    );
    expect(plans.map((plan) => plan.kind)).toEqual(['due', 'upcoming', 'overdue']);
    expect(MAX_REMINDERS_PER_REVIEW).toBe(25);
  });
});

describe('daily review scheduling', () => {
  it('is due at the local hour and expires at local midnight, across daylight saving', () => {
    const user = { id: ID, timezone: 'America/New_York' };
    // 8 March 2026: clocks go forward at 02:00 in New York (EST −5 → EDT −4).
    const before = dailyReviewJob(user, new Date('2026-03-07T15:00:00.000Z'), 8);
    expect(before).toMatchObject({
      dedupeKey: `daily_review:${ID}:2026-03-07`,
      payload: { v: 1, localDate: '2026-03-07' },
    });
    expect(before.runAt.toISOString()).toBe('2026-03-07T13:00:00.000Z');
    expect(before.expiresAt?.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    const after = dailyReviewJob(user, new Date('2026-03-08T15:00:00.000Z'), 8);
    expect(after.runAt.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(after.expiresAt?.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('uses the user’s calendar day, not the worker’s', () => {
    const instant = new Date('2026-10-31T20:00:00.000Z');
    expect(dailyReviewJob({ id: ID, timezone: 'Asia/Kolkata' }, instant, 8).payload).toEqual({
      v: 1,
      localDate: '2026-11-01',
    });
    expect(dailyReviewJob({ id: ID, timezone: 'America/Los_Angeles' }, instant, 8).payload).toEqual(
      { v: 1, localDate: '2026-10-31' },
    );
  });
});

describe('monthly summary period', () => {
  it('summarises the previous month during the first week only', () => {
    expect(summaryPeriodFor('2026-03-01')).toEqual({
      month: '2026-02',
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(summaryPeriodFor('2028-03-07')).toEqual({
      month: '2028-02',
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(summaryPeriodFor('2026-01-02')?.month).toBe('2025-12');
    expect(summaryPeriodFor('2026-03-08')).toBeUndefined();
    expect(summaryPeriodFor('2026-03-31')).toBeUndefined();
  });
});

describe('budget alert levels', () => {
  it('compares exactly and always includes the limit', () => {
    expect(alertLevels([8000, 5000])).toEqual([5000, 8000, 10_000]);
    expect(alertLevels([])).toEqual([10_000]);
    // 79.996 % has not reached 80 %.
    expect(reachedLevel([8000, 10_000], 79_996n, 100_000n)).toBeUndefined();
    expect(reachedLevel([8000, 10_000], 80_000n, 100_000n)).toBe(8000);
    expect(reachedLevel([8000, 10_000], 100_001n, 100_000n)).toBe(10_000);
    // Beyond Number's safe range, still exact.
    expect(reachedLevel([8000], 8_000_000_000_000_000n, 10_000_000_000_000_000n)).toBe(8000);
    expect(budgetAlertKey(ID, '2026-10-01', '10000', 8000)).toBe(
      `budget:${ID}:2026-10-01:10000:8000`,
    );
  });
});

describe('retry policy', () => {
  it('grows delays and stays bounded', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(JOB_RETRY_POLICY, n))).toEqual([
      30_000, 120_000, 480_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
    expect(retryDelayMs(DELIVERY_RETRY_POLICY, 1)).toBe(60_000);
  });

  it('gives up when attempts are used up or the work would expire first', () => {
    const now = new Date('2026-10-31T00:00:00.000Z');
    expect(
      decideRetry(JOB_RETRY_POLICY, { attempts: 5, maxAttempts: 5, expiresAt: null }, now),
    ).toEqual({ action: 'give_up', reason: 'attempts_exhausted' });
    expect(
      decideRetry(
        DELIVERY_RETRY_POLICY,
        { attempts: 1, maxAttempts: 5, expiresAt: new Date('2026-10-31T00:00:30.000Z') },
        now,
      ),
    ).toEqual({ action: 'give_up', reason: 'expired' });
    expect(
      decideRetry(DELIVERY_RETRY_POLICY, { attempts: 1, maxAttempts: 5, expiresAt: null }, now),
    ).toEqual({ action: 'retry', at: new Date('2026-10-31T00:01:00.000Z') });
  });
});

describe('notification wording', () => {
  it('formats exact amounts and percentages', () => {
    expect(formatMoney(12_345_678n, 'INR')).toBe('₹1,23,456.78');
    expect(formatMoney(-500n, 'USD')).toBe('−$5.00');
    expect(formatMoney(1500n, 'JPY')).toBe('JP¥1,500');
    expect(formatBasisPoints(8000n)).toBe('80%');
    expect(formatBasisPoints(3654n)).toBe('36.5%');
    expect(formatBasisPoints(-1250n)).toBe('−12.5%');
  });

  it('labels expected amounts as expected and never as paid', () => {
    const facts = {
      name: 'Rent',
      type: 'expense' as const,
      amountMinor: 2_500_000n,
      currency: 'INR' as const,
      dueDate: '2026-11-03',
      today: '2026-10-31',
    };
    expect(upcomingReminderText(facts)).toEqual({
      title: 'Rent is due in 3 days',
      body: '₹25,000.00 is expected on Tue, 3 Nov 2026. This is a reminder only — nothing has been paid or recorded.',
    });
    expect(subscriptionReminderText({ ...facts, name: 'Netflix' }).body).toContain(
      'not a charge that has happened',
    );
  });

  it('keeps long user-chosen names within the stored limits', () => {
    const text = budgetAlertText({
      name: 'x'.repeat(300),
      currency: 'INR',
      limitMinor: 10_000n,
      spentMinor: 8_000n,
      from: '2026-10-01',
      to: '2026-10-31',
      thresholdBp: 8000,
    });
    expect(Array.from(text.title).length).toBeLessThanOrEqual(160);
    expect(text.title.endsWith('…')).toBe(true);
  });
});

describe('notification e-mails', () => {
  it('escapes user text, keeps subjects generic, and links inside the app', () => {
    const message = renderNotificationEmail({
      to: 'asha@example.com',
      recipientName: 'Asha <b>Rao</b>',
      type: 'budget_approaching_limit',
      title: '<img src=x onerror=alert(1)> has used 80% of its budget',
      body: 'Body & "quotes"',
      target: { kind: 'budget', budgetId: ID, periodFrom: '2026-10-01' },
      messageId: 'abc.notification@app.calmcash.example',
      webAppUrl: 'https://app.calmcash.example',
    });
    expect(message.subject).toBe('Budget alert from CalmCash');
    expect(message.html).not.toContain('<img');
    expect(message.html).not.toContain('<b>Rao</b>');
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(message.html).toContain('Body &amp; &quot;quotes&quot;');
    expect(message.html).toContain(`https://app.calmcash.example/budgets?budget=${ID}`);
    expect(message.text).toContain('https://app.calmcash.example/settings#notifications');
    expect(message.text).toContain('Turn it off in Settings → Notifications.');
    expect(message).toMatchObject({
      template: 'notification:budget_approaching_limit',
      messageId: 'abc.notification@app.calmcash.example',
    });
  });
});
