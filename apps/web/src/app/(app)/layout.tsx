import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth, UserMenu } from '@/features/auth';
import { NotificationBell, NotificationsProvider } from '@/features/notifications';

/**
 * Every in-app destination shares the responsive shell and requires a signed-in user. Navigation
 * renders immediately; page content waits until the session is confirmed. The notification
 * provider shares the unread count between the header bell and the notification center.
 */
export default function AppLayout({ children }: LayoutProps<'/'>): ReactNode {
  return (
    <NotificationsProvider>
      <AppShell accountMenu={<UserMenu />} notifications={<NotificationBell />}>
        <RequireAuth>{children}</RequireAuth>
      </AppShell>
    </NotificationsProvider>
  );
}
