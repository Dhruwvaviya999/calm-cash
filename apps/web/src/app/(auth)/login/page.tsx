import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { AuthCardSkeleton, GuestOnly, LoginForm } from '@/features/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage(): ReactNode {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <GuestOnly>
        <LoginForm />
      </GuestOnly>
    </Suspense>
  );
}
