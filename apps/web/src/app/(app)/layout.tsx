import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';

/** Every in-app destination shares the responsive shell. Authentication arrives in Phase 3. */
export default function AppLayout({ children }: LayoutProps<'/'>): ReactNode {
  return <AppShell>{children}</AppShell>;
}
