import type { ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';

/** Fallback for segments outside the app shell; in-app pages use (app)/loading.tsx. */
export default function Loading(): ReactNode {
  return (
    <PageContainer className="min-h-dvh justify-center">
      <PageSkeleton />
    </PageContainer>
  );
}
