'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { readSelection, selectionToQuery, type DashboardSelection } from '@/features/dashboard';

/** The insights period and currency, kept in the page URL like the dashboard's. */
export function useInsightsSelection(): {
  selection: DashboardSelection;
  query: string;
  setSelection: (selection: DashboardSelection) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const selection = useMemo(() => readSelection(params), [params]);
  const query = selectionToQuery(selection);
  const setSelection = useCallback(
    (next: DashboardSelection) => {
      const search = selectionToQuery(next);
      router.replace(search === '' ? '/insights' : `/insights?${search}`, { scroll: false });
    },
    [router],
  );
  return { selection, query, setSelection };
}
