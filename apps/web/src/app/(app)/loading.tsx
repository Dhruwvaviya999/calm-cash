import type { ReactNode } from 'react';

import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';

/** Shown inside the shell while a page streams in; navigation stays usable. */
export default function AppLoading(): ReactNode {
  return (
    <PageContainer>
      <PageSkeleton />
    </PageContainer>
  );
}
