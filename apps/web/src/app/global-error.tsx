'use client'; // Error boundaries must be Client Components.

import { GeistSans } from 'geist/font/sans';
import { useEffect, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { PageShell } from '@/components/layout/page-shell';
import { applyThemePreference, readThemePreference } from '@/lib/preferences';

// Replaces the root layout when it fails, so it renders its own document, fonts, and styles.
import './globals.css';

interface GlobalErrorProps {
  error: unknown;
  retry: () => void;
}

export default function GlobalError({ error, retry }: GlobalErrorProps): ReactNode {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // This document replaces the root layout on the client, so re-apply the saved theme.
  useEffect(() => {
    applyThemePreference(readThemePreference());
  }, []);

  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body>
        <title>Something went wrong · CalmCash</title>
        <PageShell>
          <ErrorState
            headingLevel="h1"
            description="CalmCash could not be loaded. Please try again in a moment."
            onRetry={retry}
          />
        </PageShell>
      </body>
    </html>
  );
}
