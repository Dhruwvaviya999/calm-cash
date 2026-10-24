import type { ReactNode } from 'react';

/**
 * Centered, responsive content column shared by top-level pages and route fallbacks
 * (loading, error, not-found). The full navigation shell arrives with the design system.
 */
export function PageShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-8 px-4 py-12 sm:px-6">
      {children}
    </main>
  );
}
