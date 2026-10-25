import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';

/**
 * Minimal branded frame for pages rendered outside the app shell: the root not-found page and the
 * root/global error boundaries.
 */
export function PageShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col px-gutter pt-safe pb-safe">
      <header className="flex h-(--app-header-height) items-center">
        <Link href="/dashboard" aria-label="CalmCash dashboard" className="rounded-lg">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-12">
        {children}
      </main>
    </div>
  );
}
