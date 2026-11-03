import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { ScenariosPage } from '@/features/scenarios';

export const metadata: Metadata = { title: 'What-if scenarios' };

/** What-if scenarios: simulations over the person's records that never change them. */
export default function ScenariosRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <ScenariosPage />
      </Suspense>
    </PageContainer>
  );
}
