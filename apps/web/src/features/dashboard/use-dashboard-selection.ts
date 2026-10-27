'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { readSelection, selectionToQuery, type DashboardSelection } from './dashboard-selection';

/** The dashboard's period and currency, kept in the page URL. */
export function useDashboardSelection(): {
  selection: DashboardSelection;
  setSelection: (selection: DashboardSelection) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const selection = useMemo(() => readSelection(params), [params]);
  const setSelection = useCallback(
    (next: DashboardSelection) => {
      const query = selectionToQuery(next);
      router.replace(query === '' ? '/dashboard' : `/dashboard?${query}`, { scroll: false });
    },
    [router],
  );
  return { selection, setSelection };
}
