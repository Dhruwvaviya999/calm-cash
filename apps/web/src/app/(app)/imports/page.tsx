import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { ImportsPage } from '@/features/imports';

export const metadata: Metadata = { title: 'Statement imports' };

/**
 * Bank statement imports. The open import lives in the URL (`?batch=`), which is only known in the
 * browser, so the content renders on the client inside a Suspense boundary.
 */
export default function ImportsRoute(): ReactNode {
  return (
    <PageContainer>
      <Suspense fallback={<PageSkeleton />}>
        <ImportsPage />
      </Suspense>
    </PageContainer>
  );
}
