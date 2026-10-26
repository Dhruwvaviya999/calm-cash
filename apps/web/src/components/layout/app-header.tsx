import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { ThemeToggle } from '@/components/theme/theme-toggle';

import { HeaderContext } from './header-context';

/**
 * Top application bar. Mobile: compact bar with the CalmCash identity. Tablet/desktop: the
 * current location (breadcrumb). Theme and account controls are always on the right. The account
 * menu is passed in, so this design-system component stays independent of the auth feature.
 */
export function AppHeader({ accountMenu }: { accountMenu: ReactNode }): ReactNode {
  return (
    <header className="sticky top-0 z-20 border-b bg-background pt-safe">
      <div className="flex h-(--app-header-height) items-center gap-3 px-gutter">
        <Link href="/dashboard" aria-label="CalmCash dashboard" className="rounded-lg md:hidden">
          <Wordmark />
        </Link>
        <div className="hidden min-w-0 md:block">
          <HeaderContext />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {accountMenu}
        </div>
      </div>
    </header>
  );
}
