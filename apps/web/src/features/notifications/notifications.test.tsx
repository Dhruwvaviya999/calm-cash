// @vitest-environment jsdom
import type {
  NotificationDto,
  NotificationPageDto,
  NotificationPreferencesDto,
} from '@calmcash/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/layout/app-shell';
import { AuthContext } from '@/features/auth';
import { apiError, createAuthValue, TEST_USER } from '@/testing/auth';

import { NotificationBell } from './components/notification-bell';
import { NotificationPreferences } from './components/notification-preferences';
import { NotificationsPage } from './components/notifications-page';
import {
  badgeText,
  bellLabel,
  describeAge,
  notificationActionLabel,
  notificationHref,
} from './notification-presentation';
import { NotificationsProvider } from './notifications-context';

const services = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  dismissNotification: vi.fn(),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));
vi.mock('@/services/notifications.service', () => services);
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const BUDGET_ID = '0193a000-0000-7000-8000-000000000301';

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: '0193a000-0000-7000-8000-000000000401',
    type: 'budget_approaching_limit',
    category: 'budget_alerts',
    title: 'Groceries has used 85% of its budget',
    body: '₹8,500.00 of ₹10,000.00 spent for 1 Oct 2026 – 31 Oct 2026; ₹1,500.00 left.',
    target: { kind: 'budget', budgetId: BUDGET_ID, periodFrom: '2026-10-01' },
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function pageOf(items: NotificationDto[], totalPages = 1, page = 1): NotificationPageDto {
  return {
    items,
    pagination: { page, pageSize: 20, totalItems: items.length, totalPages },
    unreadCount: items.filter((item) => item.readAt === undefined).length,
  };
}

const PREFERENCES: NotificationPreferencesDto = {
  channels: {
    budget_alerts: { inApp: true, email: false },
    upcoming_payments: { inApp: true, email: false },
    overdue_payments: { inApp: true, email: false },
    subscription_renewals: { inApp: true, email: false },
    monthly_summary: { inApp: true, email: false },
  },
  paymentLeadDays: 3,
  subscriptionLeadDays: 3,
  includeRecurringIncome: false,
  email: { address: TEST_USER.email, verified: true },
  automation: { status: 'running', lastSeenAt: '2026-10-31T05:00:00.000Z' },
};

function renderSignedIn(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <AuthContext value={createAuthValue()}>
      <NotificationsProvider>{ui}</NotificationsProvider>
    </AuthContext>,
  );
}

beforeEach(() => {
  // jsdom has no media queries; the shell's theme control asks for the OS preference.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  for (const mock of Object.values(services)) mock.mockReset();
  services.getUnreadNotificationCount.mockResolvedValue({ unreadCount: 0 });
});

describe('notification presentation', () => {
  it('never invents a count and bounds the badge', () => {
    expect(bellLabel(undefined)).toBe('Notifications');
    expect(bellLabel(0)).toBe('Notifications, none unread');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(250)).toBe('99+');
  });

  it('links inside the app from identifiers only', () => {
    expect(
      notificationHref({ kind: 'budget', budgetId: BUDGET_ID, periodFrom: '2026-10-01' }),
    ).toEqual({
      pathname: '/budgets',
      query: { budget: BUDGET_ID },
    });
    expect(notificationHref({ kind: 'notification_settings' })).toEqual({
      pathname: '/settings',
      query: {},
      hash: 'notifications',
    });
    expect(notificationActionLabel(undefined)).toBe('View notifications');
  });

  it('describes how long ago, then falls back to the date', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    const date = (): string => 'the date';
    expect(describeAge('2026-10-31T11:59:30.000Z', now, date)).toBe('just now');
    expect(describeAge('2026-10-31T11:15:00.000Z', now, date)).toBe('45 minutes ago');
    expect(describeAge('2026-10-31T09:00:00.000Z', now, date)).toBe('3 hours ago');
    expect(describeAge('2026-10-30T09:00:00.000Z', now, date)).toBe('yesterday');
    expect(describeAge('2026-10-01T09:00:00.000Z', now, date)).toBe('the date');
  });
});

describe('NotificationBell', () => {
  it('shows the unread count only once the API answered, and previews recent notifications', async () => {
    let answer: (value: { unreadCount: number }) => void = () => undefined;
    services.getUnreadNotificationCount.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    services.listNotifications.mockResolvedValue(
      pageOf([
        notification(),
        notification({
          id: '0193a000-0000-7000-8000-000000000402',
          readAt: '2026-10-31T05:00:00.000Z',
          title: 'Rent is due in 3 days',
          type: 'recurring_payment_upcoming',
          category: 'upcoming_payments',
          target: { kind: 'notification_settings' },
        }),
      ]),
    );
    renderSignedIn(<NotificationBell />);

    // Loading: a plain label, no number.
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    expect(trigger.textContent).toBe('');
    act(() => {
      answer({ unreadCount: 3 });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
    });
    // Phones get a link to the full page instead of the popover.
    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' }).getAttribute('href')).toBe(
      '/notifications',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 3 unread' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Groceries has used 85% of its budget');
    // Unread is spelled out, not only shown by colour.
    expect(within(dialog).getByText('New')).toBeTruthy();
    expect(within(dialog).getByText('(unread)')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'View budget' }).getAttribute('href')).toBe(
      `/budgets?budget=${BUDGET_ID}`,
    );
    expect(within(dialog).getByRole('link', { name: 'View all notifications' })).toBeTruthy();
    expect(within(dialog).getAllByText('2 hours ago').length).toBeGreaterThan(0);
  });

  it('marks everything read from the preview', async () => {
    services.getUnreadNotificationCount.mockResolvedValueOnce({ unreadCount: 1 });
    services.listNotifications.mockResolvedValue(pageOf([notification()]));
    services.markAllNotificationsRead.mockResolvedValue({ updatedCount: 1, unreadCount: 0 });
    renderSignedIn(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark all as read' }));
    expect(services.markAllNotificationsRead).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications, none unread' })).toBeTruthy();
    });
  });

  it('keeps the app shell usable when notifications cannot be loaded', async () => {
    services.getUnreadNotificationCount.mockRejectedValue(apiError('NETWORK_ERROR', 'Offline'));
    render(
      <AuthContext value={createAuthValue()}>
        <NotificationsProvider>
          <AppShell accountMenu={<span>Account</span>} notifications={<NotificationBell />}>
            <p>Dashboard content</p>
          </AppShell>
        </NotificationsProvider>
      </AuthContext>,
    );
    await waitFor(() => {
      expect(services.getUnreadNotificationCount).toHaveBeenCalled();
    });
    expect(screen.getByText('Dashboard content')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' }).length).toBeGreaterThan(
      0,
    );
  });
});

describe('NotificationsPage', () => {
  it('lists notifications and moves them from unread to read', async () => {
    const item = notification();
    services.listNotifications.mockResolvedValue(pageOf([item]));
    services.getUnreadNotificationCount.mockResolvedValue({ unreadCount: 1 });
    services.markNotificationRead.mockResolvedValue({
      ...item,
      readAt: '2026-10-31T06:00:00.000Z',
    });
    renderSignedIn(<NotificationsPage />);

    const article = await screen.findByRole('article', { name: /Groceries has used 85%/ });
    expect(within(article).getByText('New')).toBeTruthy();
    await userEvent.click(within(article).getByRole('button', { name: /Mark as read/ }));
    expect(services.markNotificationRead).toHaveBeenCalledWith(item.id);
    await waitFor(() => {
      expect(within(article).queryByText('New')).toBeNull();
    });
  });

  it('dismisses, filters, and pages through older notifications', async () => {
    const first = notification();
    const second = notification({
      id: '0193a000-0000-7000-8000-000000000402',
      title: 'Rent is due today',
      type: 'recurring_payment_due',
    });
    const older = notification({
      id: '0193a000-0000-7000-8000-000000000403',
      title: 'Your September 2026 summary (INR)',
      type: 'monthly_summary_ready',
    });
    services.listNotifications.mockImplementation(
      ({ status, page }: { status: string; page: number }) =>
        Promise.resolve(
          status === 'unread'
            ? pageOf([])
            : page === 1
              ? pageOf([first, second], 2)
              : pageOf([older], 2, 2),
        ),
    );
    services.dismissNotification.mockResolvedValue({ updatedCount: 1, unreadCount: 1 });
    renderSignedIn(<NotificationsPage />);

    await screen.findByText('Rent is due today');
    await userEvent.click(screen.getByRole('button', { name: 'Show older notifications' }));
    await screen.findByText('Your September 2026 summary (INR)');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: Rent is due today' }));
    await waitFor(() => {
      expect(screen.queryByText('Rent is due today')).toBeNull();
    });

    await userEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    expect(screen.getByRole('button', { name: /^Unread/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await screen.findByText('You’re all caught up');
  });

  it('explains an empty center and recovers from an error', async () => {
    services.listNotifications
      .mockRejectedValueOnce(apiError('NETWORK_ERROR', 'Offline'))
      .mockResolvedValue(pageOf([]));
    renderSignedIn(<NotificationsPage />);
    await screen.findByText('Notifications could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByText('No notifications yet');
  });
});

describe('NotificationPreferences', () => {
  it('loads the current choices and saves a change', async () => {
    services.getNotificationPreferences.mockResolvedValue(PREFERENCES);
    services.updateNotificationPreferences.mockImplementation((input: object) =>
      Promise.resolve({ ...PREFERENCES, ...input, updatedAt: '2026-10-31T06:00:00.000Z' }),
    );
    renderSignedIn(<NotificationPreferences />);

    const email = await screen.findByRole('checkbox', { name: 'By e-mail: Monthly summary' });
    expect(email).toHaveProperty('checked', false);
    expect(screen.getByText('Reminders are running')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save notification preferences' });
    expect(save.hasAttribute('disabled')).toBe(true);

    await userEvent.click(email);
    await userEvent.selectOptions(screen.getByLabelText('Remind me about bills'), '7');
    await userEvent.click(save);

    expect(services.updateNotificationPreferences).toHaveBeenCalledWith({
      channels: { ...PREFERENCES.channels, monthly_summary: { inApp: true, email: true } },
      paymentLeadDays: 7,
      subscriptionLeadDays: 3,
      includeRecurringIncome: false,
    });
    await screen.findByText('Your notification preferences were saved.');
  });

  it('keeps e-mail off for an unverified address and says when reminders are paused', async () => {
    services.getNotificationPreferences.mockResolvedValue({
      ...PREFERENCES,
      email: { address: TEST_USER.email, verified: false },
      automation: { status: 'not_running' },
    });
    renderSignedIn(<NotificationPreferences />);
    const email = await screen.findByRole('checkbox', { name: 'By e-mail: Budget alerts' });
    expect(email.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText('Reminders are paused')).toBeTruthy();
  });

  it('shows a retryable error when preferences cannot be loaded', async () => {
    services.getNotificationPreferences.mockRejectedValue(apiError('NETWORK_ERROR', 'Offline'));
    renderSignedIn(<NotificationPreferences />);
    await screen.findByText('Notification preferences could not be loaded');
  });
});
