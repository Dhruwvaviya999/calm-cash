'use client'; // Error boundaries must be Client Components.

import { useEffect, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { PageShell } from '@/components/layout/page-shell';

interface ErrorPageProps {
  /** The thrown value; not necessarily an `Error` when thrown from a Client Component. */
  error: unknown;
  /** Re-fetches and re-renders the failed segment. */
  retry: () => void;
}

/** Server errors carry a `digest` that matches the server-side log entry. */
function getErrorDigest(error: unknown): string | undefined {
  return error instanceof Error && 'digest' in error && typeof error.digest === 'string'
    ? error.digest
    : undefined;
}

/** Last-resort boundary for failures outside the app shell (in-app pages use (app)/error.tsx). */
export default function ErrorPage({ error, retry }: ErrorPageProps): ReactNode {
  useEffect(() => {
    // Replaced by an error-reporting integration in a later phase.
    console.error(error);
  }, [error]);

  const digest = getErrorDigest(error);

  return (
    <PageShell>
      <ErrorState
        headingLevel="h1"
        description="An unexpected error occurred while loading this page. Please try again."
        onRetry={retry}
        {...(digest === undefined ? {} : { reference: digest })}
      />
    </PageShell>
  );
}
