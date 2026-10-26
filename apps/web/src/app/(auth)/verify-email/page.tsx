import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { AuthCardSkeleton, VerifyEmailPanel } from '@/features/auth';

// The URL carries a one-time token: keep the page out of search indexes.
export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage(): ReactNode {
  return (
    <Suspense fallback={<AuthCardSkeleton label="Confirming your email address…" />}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
