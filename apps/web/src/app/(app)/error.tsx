'use client'; // Error boundaries must be Client Components.

import { useEffect, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { PageContainer } from '@/components/layout/page-container';

interface AppErrorProps {
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

/** Contains a page failure inside the shell, so navigation keeps working. */
export default function AppError({ error, retry }: AppErrorProps): ReactNode {
  useEffect(() => {
    // Replaced by an error-reporting integration in a later phase.
    console.error(error);
  }, [error]);

  const digest = getErrorDigest(error);

  return (
    <PageContainer>
      <ErrorState
        description="This page could not be displayed. Your data is safe — please try again, or choose another section."
        onRetry={retry}
        {...(digest === undefined ? {} : { reference: digest })}
      />
    </PageContainer>
  );
}
