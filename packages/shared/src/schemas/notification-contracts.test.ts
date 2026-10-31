import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import {
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_CATEGORY,
  NOTIFICATION_TYPES,
} from '../constants/notifications';
import { notificationHref, notificationLocation } from '../notifications/navigation';
import type {
  MarkNotificationsReadInput,
  MonthlySummaryDto,
  NotificationDto,
  NotificationListQuery,
  NotificationPageDto,
  NotificationPreferencesDto,
  NotificationTargetDto,
  UpdateNotificationPreferencesInput,
} from '../types/notification';
import type { notificationDtoSchema } from './notification';
import {
  automationJobPayloadSchema,
  markNotificationsReadInputSchema,
  notificationListQuerySchema,
  notificationTargetDtoSchema,
  reminderLeadDaysSchema,
  updateNotificationPreferencesInputSchema,
  type monthlySummaryDtoSchema,
  type notificationPageDtoSchema,
  type notificationPreferencesDtoSchema,
} from './notification';

const ID = '01928c7e-4a5b-7c3d-8e9f-0a1b2c3d4e5f';

describe('notification schema ⇄ interface contracts', () => {
  it('infers exactly the notification types', () => {
    expectTypeOf<z.output<typeof notificationDtoSchema>>().toEqualTypeOf<NotificationDto>();
    expectTypeOf<z.output<typeof notificationPageDtoSchema>>().toEqualTypeOf<NotificationPageDto>();
    expectTypeOf<
      z.output<typeof notificationListQuerySchema>
    >().toEqualTypeOf<NotificationListQuery>();
    expectTypeOf<
      z.output<typeof notificationTargetDtoSchema>
    >().toEqualTypeOf<NotificationTargetDto>();
    expectTypeOf<
      z.output<typeof markNotificationsReadInputSchema>
    >().toEqualTypeOf<MarkNotificationsReadInput>();
    expectTypeOf<
      z.output<typeof notificationPreferencesDtoSchema>
    >().toEqualTypeOf<NotificationPreferencesDto>();
    expectTypeOf<
      z.output<typeof updateNotificationPreferencesInputSchema>
    >().toEqualTypeOf<UpdateNotificationPreferencesInput>();
    expectTypeOf<z.output<typeof monthlySummaryDtoSchema>>().toEqualTypeOf<MonthlySummaryDto>();
  });
});

describe('notification taxonomy', () => {
  it('gives every type a category or marks it as a service notice', () => {
    expect(Object.keys(NOTIFICATION_TYPE_CATEGORY).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    const used = new Set(
      Object.values(NOTIFICATION_TYPE_CATEGORY).filter((value) => value !== null),
    );
    expect([...used].sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });

  it('defaults to in-app only: nothing is e-mailed until someone opts in', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(DEFAULT_NOTIFICATION_CHANNELS[category]).toEqual({ inApp: true, email: false });
    }
  });
});

describe('notification request schemas', () => {
  it('reads the list query with defaults and bounds the page size', () => {
    expect(notificationListQuerySchema.parse({})).toEqual({
      status: 'all',
      page: 1,
      pageSize: 20,
    });
    expect(
      notificationListQuerySchema.parse({ status: 'unread', page: '2', pageSize: '50' }),
    ).toEqual({ status: 'unread', page: 2, pageSize: 50 });
    expect(notificationListQuerySchema.safeParse({ pageSize: '51' }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ userId: ID }).success).toBe(false);
  });

  it('accepts only known lead times', () => {
    expect(reminderLeadDaysSchema.safeParse(1).success).toBe(true);
    expect(reminderLeadDaysSchema.safeParse(3).success).toBe(true);
    expect(reminderLeadDaysSchema.safeParse(7).success).toBe(true);
    for (const value of [0, 2, 8, 30, 365, -1, 3.5, '3']) {
      expect(reminderLeadDaysSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts partial preference changes and rejects unknown or empty ones', () => {
    expect(
      updateNotificationPreferencesInputSchema.parse({
        channels: { budget_alerts: { email: true } },
        paymentLeadDays: 7,
      }),
    ).toEqual({ channels: { budget_alerts: { email: true } }, paymentLeadDays: 7 });
    expect(updateNotificationPreferencesInputSchema.safeParse({}).success).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({ channels: {} }).success).toBe(
      false,
    );
    expect(
      updateNotificationPreferencesInputSchema.safeParse({ channels: { budget_alerts: {} } })
        .success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({ channels: { sms: { inApp: true } } })
        .success,
    ).toBe(false);
    expect(updateNotificationPreferencesInputSchema.safeParse({ userId: ID }).success).toBe(false);
    expect(
      updateNotificationPreferencesInputSchema.safeParse({ subscriptionLeadDays: 14 }).success,
    ).toBe(false);
  });

  it('bounds bulk read requests', () => {
    expect(markNotificationsReadInputSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(markNotificationsReadInputSchema.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);
    expect(
      markNotificationsReadInputSchema.safeParse({ ids: Array.from({ length: 101 }, () => ID) })
        .success,
    ).toBe(false);
    expect(markNotificationsReadInputSchema.safeParse({ ids: [ID] }).success).toBe(true);
  });
});

describe('notification targets', () => {
  it('holds identifiers only, never a URL', () => {
    expect(
      notificationTargetDtoSchema.safeParse({
        kind: 'budget',
        budgetId: ID,
        periodFrom: '2026-10-01',
      }).success,
    ).toBe(true);
    expect(
      notificationTargetDtoSchema.safeParse({ kind: 'link', href: 'https://evil.example' }).success,
    ).toBe(false);
    expect(
      notificationTargetDtoSchema.safeParse({
        kind: 'budget',
        budgetId: ID,
        periodFrom: '2026-10-01',
        href: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      notificationTargetDtoSchema.safeParse({
        kind: 'budget',
        budgetId: '../admin',
        periodFrom: '2026-10-01',
      }).success,
    ).toBe(false);
  });
});

describe('automation job payloads', () => {
  it('reads every known kind and refuses unknown versions or kinds', () => {
    expect(
      automationJobPayloadSchema.safeParse({ kind: 'budget_evaluation', payload: { v: 1 } })
        .success,
    ).toBe(true);
    expect(
      automationJobPayloadSchema.safeParse({
        kind: 'daily_review',
        payload: { v: 1, localDate: '2026-10-28' },
      }).success,
    ).toBe(true);
    expect(
      automationJobPayloadSchema.safeParse({ kind: 'budget_evaluation', payload: { v: 2 } })
        .success,
    ).toBe(false);
    expect(
      automationJobPayloadSchema.safeParse({ kind: 'send_money', payload: { v: 1 } }).success,
    ).toBe(false);
    expect(
      automationJobPayloadSchema.safeParse({
        kind: 'daily_review',
        payload: { v: 1, localDate: '2026-02-30' },
      }).success,
    ).toBe(false);
  });
});

describe('notification links', () => {
  it('lead to the related page inside the app', () => {
    expect(notificationHref({ kind: 'budget', budgetId: ID, periodFrom: '2026-10-01' })).toBe(
      `/budgets?budget=${ID}`,
    );
    expect(
      notificationHref({
        kind: 'recurring',
        scheduleId: ID,
        scheduledDate: '2026-10-31',
        dueDate: '2026-11-02',
      }),
    ).toBe(`/budgets?section=recurring&schedule=${ID}`);
    expect(
      notificationHref({
        kind: 'subscription',
        scheduleId: ID,
        scheduledDate: '2026-10-31',
        dueDate: '2026-10-31',
      }),
    ).toBe(`/budgets?section=subscriptions&schedule=${ID}`);
    expect(
      notificationHref({
        kind: 'dashboard',
        from: '2026-09-01',
        to: '2026-09-30',
        currency: 'INR',
      }),
    ).toBe('/dashboard?period=custom&from=2026-09-01&to=2026-09-30&currency=INR');
    expect(notificationHref({ kind: 'notification_settings' })).toBe('/settings#notifications');
    expect(notificationHref(undefined)).toBe('/notifications');
    expect(notificationLocation(undefined).pathname).toBe('/notifications');
  });
});
