'use client'; // Error boundaries must be Client Components.

import { useEffect, type ReactNode } from 'react';

import { PageShell } from '@/components/layout/page-shell';
import { outlineButtonClasses } from '@/components/ui/button-classes';

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

export default function ErrorPage({ error, retry }: ErrorPageProps): ReactNode {
  useEffect(() => {
    // Replaced by an error-reporting integration in a later phase.
    console.error(error);
  }, [error]);

  const digest = getErrorDigest(error);

  return (
    <PageShell>
      <div role="alert" className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error occurred while loading this page. Please try again.
        </p>
        {digest !== undefined && (
          <p className="text-xs text-muted-foreground">
            Reference: <code>{digest}</code>
          </p>
        )}
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
  );
}
