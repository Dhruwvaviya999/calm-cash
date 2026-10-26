import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth, UserMenu } from '@/features/auth';

/**
 * Every in-app destination shares the responsive shell and requires a signed-in user. Navigation
 * renders immediately; page content waits until the session is confirmed.
 */
export default function AppLayout({ children }: LayoutProps<'/'>): ReactNode {
  return (
    <AppShell accountMenu={<UserMenu />}>
      <RequireAuth>{children}</RequireAuth>
    </AppShell>
  );
}
