'use client'; // Error boundaries must be Client Components.

import { useEffect, type ReactNode } from 'react';

import { PageShell } from '@/components/layout/page-shell';
import { outlineButtonClasses } from '@/components/ui/button-classes';

// Replaces the root layout when it fails, so it renders its own document and styles.
import './globals.css';

interface GlobalErrorProps {
  error: unknown;
  retry: () => void;
}

export default function GlobalError({ error, retry }: GlobalErrorProps): ReactNode {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <title>Something went wrong · CalmCash</title>
        <PageShell>
          <div role="alert" className="space-y-4">
            <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="text-muted-foreground">
              CalmCash could not be loaded. Please try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => {
                retry();
              }}
              className={outlineButtonClasses}
            >
              Try again
            </button>
          </div>
        </PageShell>
      </body>
    </html>
  );
}
