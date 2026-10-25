'use client';

import type { TransactionType } from '@calmcash/shared';
import { SearchX } from 'lucide-react';
import { useDeferredValue, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { FilterBar, FilterOptions, type FilterOption } from '@/components/forms/filter-bar';
import { SearchInput } from '@/components/forms/search-input';

/** A server-rendered row plus the plain data the client needs to filter it. */
export interface ExplorerRow {
  id: string;
  type: TransactionType;
  /** Lower-case text matched by the search box (merchant, purpose, category, account). */
  searchText: string;
  content: ReactNode;
}

type TypeFilter = 'all' | TransactionType;

const TYPE_FILTERS: readonly FilterOption<TypeFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Credits' },
  { value: 'expense', label: 'Debits' },
  { value: 'transfer', label: 'Transfers' },
];

/**
 * Client-side search and type filtering over rows rendered on the server. In the design preview
 * it filters sample data only; the real list (Phase 5) will query the API instead.
 */
export function TransactionExplorer({ rows }: { rows: readonly ExplorerRow[] }): ReactNode {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const visible = rows.filter(
    (row) => (type === 'all' || row.type === type) && row.searchText.includes(deferredQuery),
  );

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <SearchInput
          label="Search transactions"
          placeholder="Search merchant or purpose"
          value={query}
          onValueChange={setQuery}
          className="sm:w-80"
        />
        <FilterOptions
          legend="Transaction type"
          name="transaction-type"
          options={TYPE_FILTERS}
          value={type}
          onValueChange={setType}
        />
      </FilterBar>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        Showing {visible.length} of {rows.length} sample transactions
      </p>

      {visible.length > 0 ? (
        <ul
          aria-label="Sample transactions"
          className="divide-y rounded-2xl border bg-card px-4 shadow-sm sm:px-5"
        >
          {visible.map((row) => (
            <li key={row.id}>{row.content}</li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={SearchX}
          headingLevel="h3"
          title="No matching transactions"
          description="Try a different search term or another type filter."
        />
      )}
    </div>
  );
}
