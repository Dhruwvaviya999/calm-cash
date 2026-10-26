import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { AuthCardSkeleton, ResetPasswordForm } from '@/features/auth';

// The URL carries a one-time token: keep the page out of search indexes.
export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage(): ReactNode {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
