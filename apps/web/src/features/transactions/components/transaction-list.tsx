import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { TransactionListItem } from '../types';
import { TransactionRow } from './transaction-row';

/** A divided list of transactions. Pass items already sorted (newest first). */
export function TransactionList({
  items,
  label,
  className,
}: {
  items: readonly TransactionListItem[];
  /** Accessible name of the list, e.g. "Recent transactions". */
  label: string;
  className?: string;
}): ReactNode {
  return (
    <ul aria-label={label} className={cn('divide-y', className)}>
      {items.map((item) => (
        <li key={item.transaction.id}>
          <TransactionRow item={item} />
        </li>
      ))}
    </ul>
  );
}
