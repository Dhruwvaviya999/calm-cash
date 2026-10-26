'use client';

import { AUTH_TOKEN_PATTERN } from '@calmcash/shared';
import { CircleCheck, LinkIcon, MailQuestion, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { describeRequestError } from '@/lib/form-errors';
import { verifyEmail } from '@/services/auth.service';

import { useLinkToken } from '../use-link-token';
import { AuthCard, AuthCardSkeleton } from './auth-card';
import { AuthIcon } from './auth-icon';
import { ResendVerification } from './resend-verification';

type Status =
  | { kind: 'verifying' }
  | { kind: 'verified' }
  | { kind: 'invalid' }
  | { kind: 'failed'; message: string };

// One request per token, even when React runs effects twice (Strict Mode) or the panel remounts:
// a second request would only find the token already used.
const verifications = new Map<string, Promise<void>>();

function verifyOnce(token: string): Promise<void> {
  let pending = verifications.get(token);
  if (pending === undefined) {
    pending = verifyEmail(token).then(() => undefined);
    verifications.set(token, pending);
    pending.catch(() => {
      verifications.delete(token); // Allow a retry after a failure.
    });
  }
  return pending;
}

const SIGN_IN_LINK = (
  <Link href="/login" className="font-medium text-primary hover:underline">
    Back to sign in
  </Link>
);

/** Consumes the confirmation link from the e-mail. Uses `useSearchParams` (wrap in <Suspense>). */
export function VerifyEmailPanel(): ReactNode {
  const { token, forget } = useLinkToken();
  const usable = token !== null && AUTH_TOKEN_PATTERN.test(token);
  const [status, setStatus] = useState<Status>(
    usable ? { kind: 'verifying' } : { kind: 'invalid' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!usable) {
      return undefined;
    }
    let active = true;
    verifyOnce(token).then(
      () => {
        forget();
        if (active) {
          setStatus({ kind: 'verified' });
        }
      },
      (error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ApiClientError && error.code === 'INVALID_TOKEN') {
          forget();
          setStatus({ kind: 'invalid' });
        } else {
          setStatus({ kind: 'failed', message: describeRequestError(error) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [usable, token, forget, attempt]);

  switch (status.kind) {
    case 'verifying':
      return <AuthCardSkeleton label="Confirming your email address…" />;

    case 'verified':
      return (
        <AuthCard
          eyebrow={<AuthIcon icon={CircleCheck} tone="success" />}
          title="Your email address is confirmed"
          description="Thank you. Your CalmCash account is ready — sign in to get started."
        >
          <Button asChild size="lg" className="h-11 w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </AuthCard>
      );

    case 'failed':
      return (
        <AuthCard
          eyebrow={<AuthIcon icon={MailQuestion} tone="warning" />}
          title="We could not confirm your email yet"
          footer={SIGN_IN_LINK}
        >
          <FormMessage tone="error">{status.message}</FormMessage>
          <Button
            size="lg"
            className="h-11 w-full"
            onClick={() => {
              setStatus({ kind: 'verifying' });
              setAttempt((current) => current + 1);
            }}
          >
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </AuthCard>
      );

    case 'invalid':
      return (
        <AuthCard
          eyebrow={<AuthIcon icon={LinkIcon} tone="warning" />}
          title="This confirmation link cannot be used"
          description="It may be incomplete, it may have expired, or your address may already be confirmed — in that case, simply sign in. Otherwise, request a new link below."
          footer={SIGN_IN_LINK}
        >
          <ResendVerification idPrefix="verify-resend" />
        </AuthCard>
      );
  }
}
