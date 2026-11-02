import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { AssistantPage } from '@/features/assistant';

export const metadata: Metadata = { title: 'Assistant' };

/**
 * The financial assistant. The open conversation lives in the URL, which is only known in the
 * browser, so the content renders inside Suspense.
 */
export default function AssistantRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <AssistantPage />
      </Suspense>
    </PageContainer>
  );
}
