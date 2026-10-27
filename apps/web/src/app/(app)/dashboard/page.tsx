import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { DashboardPage } from '@/features/dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The live dashboard. Its period and currency live in the URL, which is only known in the browser,
 * so the content renders on the client inside a Suspense boundary.
 */
export default function DashboardRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <DashboardPage />
      </Suspense>
    </PageContainer>
  );
}
