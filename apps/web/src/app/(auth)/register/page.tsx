import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import { AuthCardSkeleton, GuestOnly, RegisterForm } from '@/features/auth';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage(): ReactNode {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <GuestOnly>
        <RegisterForm />
      </GuestOnly>
    </Suspense>
  );
}
