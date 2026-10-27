import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { PlanningPage } from '@/features/planning';

export const metadata: Metadata = { title: 'Budgets & planning' };

/**
 * Live planning: budgets, recurring payments, subscriptions, and savings goals. The section lives
 * in the URL, which is only known in the browser, so the content renders inside Suspense.
 */
export default function BudgetsRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <PlanningPage />
      </Suspense>
    </PageContainer>
  );
}
