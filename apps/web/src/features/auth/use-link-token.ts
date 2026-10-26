'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

export interface LinkToken {
  /** The `token` query parameter as it was when the page opened. */
  token: string | null;
  /** Removes the token from the address bar and history once it is no longer needed. */
  forget: () => void;
}

/**
 * Reads the one-time token of an e-mailed link. The value is captured once, so removing it from
 * the URL afterwards (to keep it out of history and shared screenshots) does not change the page.
 * Uses `useSearchParams`, so render inside a <Suspense> boundary.
 */
export function useLinkToken(): LinkToken {
  const searchParams = useSearchParams();
  const [token] = useState(() => searchParams.get('token'));

  const forget = useCallback(() => {
    if (new URLSearchParams(window.location.search).has('token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return { token, forget };
}
