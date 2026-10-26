import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { TransactionsPage } from '@/features/transactions';

export const metadata: Metadata = { title: 'Transactions' };

/**
 * Live transaction management. Filters live in the URL, which is only known in the browser, so the
 * page content renders on the client inside a Suspense boundary.
 */
export default function TransactionsRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <TransactionsPage />
      </Suspense>
    </PageContainer>
  );
}
