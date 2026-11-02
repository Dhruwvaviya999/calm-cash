import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { InsightsPage } from '@/features/insights';

export const metadata: Metadata = { title: 'Insights' };

/**
 * Spending patterns, possible bills and subscriptions, suggestions, and reports. The period lives
 * in the URL, which is only known in the browser, so the content renders inside Suspense.
 */
export default function InsightsRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <InsightsPage />
      </Suspense>
    </PageContainer>
  );
}
