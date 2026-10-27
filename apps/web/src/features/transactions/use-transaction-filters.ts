'use client';

import { entityIdSchema } from '@calmcash/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { filtersToSearch, readFilters, type TransactionFilters } from './transaction-filters';

export interface TransactionFiltersState {
  filters: TransactionFilters;
  /** Replaces the URL (no new history entry), which re-renders with the new filters. */
  setFilters: (filters: TransactionFilters) => void;
  /** `?reconcile=<accountId>`: another page asked to open the balance correction for an account. */
  reconcileAccountId: string | undefined;
  /** `?new=1`: another page asked to open the add form. */
  wantsNew: boolean;
  /** `?transaction=<id>`: another page links to one transaction's details. */
  linkedTransactionId: string | undefined;
}

/** The transaction list's filters, kept in the page URL. */
export function useTransactionFilters(): TransactionFiltersState {
  const params = useSearchParams();
  const router = useRouter();
  const filters = useMemo(() => readFilters(params), [params]);
  const reconcile = entityIdSchema.safeParse(params.get('reconcile'));
  const linked = entityIdSchema.safeParse(params.get('transaction'));

  const setFilters = useCallback(
    (next: TransactionFilters) => {
      const search = filtersToSearch(next);
      router.replace(search === '' ? '/transactions' : `/transactions?${search}`, {
        scroll: false,
      });
    },
    [router],
  );

  return {
    filters,
    setFilters,
    reconcileAccountId: reconcile.success ? reconcile.data : undefined,
    wantsNew: params.get('new') === '1',
    linkedTransactionId: linked.success ? linked.data : undefined,
  };
}
