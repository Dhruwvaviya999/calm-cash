'use client';

import { LoaderCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { getSafeReturnPath, RETURN_TO_PARAM } from '@/lib/return-to';

import { useAuth } from '../auth-context';
import { AuthCardSkeleton } from './auth-card';

/**
 * For the sign-in and registration pages: signed-in users are sent on to the app (to the page
 * they originally asked for, if it is a known destination). Uses `useSearchParams`, so render it
 * inside a <Suspense> boundary.
 */
export function GuestOnly({ children }: { children: ReactNode }): ReactNode {
  const { state } = useAuth();
  const router = useRouter();
  const destination = getSafeReturnPath(useSearchParams().get(RETURN_TO_PARAM));

  useEffect(() => {
    if (state.status === 'authenticated') {
      router.replace(destination);
    }
  }, [state.status, destination, router]);

  if (state.status === 'loading') {
    return <AuthCardSkeleton label="Checking whether you are signed in…" />;
  }

  if (state.status === 'authenticated') {
    return (
      <Card
        role="status"
        className="flex w-full flex-col items-center gap-3 p-8 text-center text-muted-foreground"
      >
        <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-primary" />
        <p>
          Signed in as{' '}
          <span className="font-medium text-foreground">{state.session.user.name}</span>. Opening
          CalmCash…
        </p>
      </Card>
    );
  }

  return children;
}
