'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { PageSkeleton } from '@/components/feedback/loading-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { buildLoginHref } from '@/lib/return-to';

import { useAuth } from '../auth-context';

/**
 * Renders in-app pages only for a signed-in user. While the session is being checked (or the user
 * is being redirected to sign in) a neutral skeleton is shown, so protected content never flashes
 * for signed-out visitors.
 *
 * This is a user-experience boundary, not a security boundary: the API authorises every request,
 * and pages hold no user data of their own until they fetch it with the session cookie.
 */
export function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const { state, retry } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== 'unauthenticated') {
      return;
    }
    router.replace(
      state.reason === 'signed-out'
        ? buildLoginHref({ notice: 'signed-out' })
        : buildLoginHref({
            returnTo: pathname,
            notice: state.reason === 'session-ended' ? 'session-ended' : undefined,
          }),
    );
  }, [state, pathname, router]);

  if (state.status === 'authenticated') {
    return children;
  }

  if (state.status === 'error') {
    return (
      <PageContainer>
        <ErrorState
          title="We could not check your sign-in"
          description="CalmCash could not reach its service. Your data is safe — check your connection and try again."
          onRetry={retry}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageSkeleton />
    </PageContainer>
  );
}
