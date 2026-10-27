'use client';

import type { AccountDto, CategoryDto } from '@calmcash/shared';
import { useCallback } from 'react';

import { useAsyncResource } from '@/hooks/use-async-resource';
import { listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import type { AsyncState } from '@/types/async-state';

export interface PlanningReferences {
  /** Every account (archived ones too, so existing plans can still name theirs). */
  accounts: AccountDto[];
  categories: CategoryDto[];
}

const NONE: PlanningReferences = { accounts: [], categories: [] };

/** Accounts and categories the planning forms offer, loaded once per section. */
export function usePlanningReferences(): {
  state: AsyncState<PlanningReferences>;
  references: PlanningReferences;
} {
  const { state } = useAsyncResource(
    useCallback(async (signal: AbortSignal): Promise<PlanningReferences> => {
      const [accounts, categories] = await Promise.all([
        listAccounts('all', signal),
        listCategories(signal),
      ]);
      return {
        accounts: accounts.accounts.map((entry) => entry.account),
        categories: categories.categories,
      };
    }, []),
  );
  return { state, references: state.status === 'success' ? state.data : NONE };
}
