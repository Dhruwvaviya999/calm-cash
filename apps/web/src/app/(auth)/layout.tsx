import type { ReactNode } from 'react';

import { AuthShell } from '@/components/layout/auth-shell';

/** Public authentication pages share a calm, focused frame outside the app shell. */
export default function AuthLayout({ children }: LayoutProps<'/'>): ReactNode {
  return <AuthShell>{children}</AuthShell>;
}
