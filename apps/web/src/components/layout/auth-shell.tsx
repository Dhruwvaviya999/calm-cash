import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { ThemeToggle } from '@/components/theme/theme-toggle';

/**
 * Frame of the public authentication pages (sign in, registration, recovery): the CalmCash
 * identity, the theme control, and one centred column that fits a 320px screen.
 */
export function AuthShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col px-gutter pt-safe pb-safe">
      <header className="flex h-(--app-header-height) items-center justify-between gap-3">
        <Link href="/login" aria-label="CalmCash sign in" className="rounded-lg">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8 sm:py-12"
      >
        {children}
      </main>
    </div>
  );
}
