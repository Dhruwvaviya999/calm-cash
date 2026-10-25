import type { ReactNode } from 'react';

import { SectionHeader } from '@/components/layout/page-header';
import { SectionLink } from '@/components/layout/section-link';
import { Card } from '@/components/ui/card';
import { TransactionList, type TransactionListItem } from '@/features/transactions';
import { cn } from '@/lib/utils';

/** The latest debits and credits, so users can recall where each payment went. */
export function RecentTransactions({
  items,
  className,
}: {
  items: readonly TransactionListItem[];
  className?: string;
}): ReactNode {
  return (
    <Card className={cn('px-5 pt-5 pb-2 sm:px-6 sm:pt-6', className)}>
      <section aria-labelledby="recent-heading">
        <SectionHeader
          id="recent-heading"
          title="Recent transactions"
          description="Your latest debits and credits"
          action={<SectionLink href="/transactions">See all</SectionLink>}
        />
        {/* Phones show four rows; larger screens show the full preview. */}
        <TransactionList
          label="Recent transactions"
          items={items}
          className="mt-2 max-sm:[&>li:nth-child(n+5)]:hidden"
        />
      </section>
    </Card>
  );
}
