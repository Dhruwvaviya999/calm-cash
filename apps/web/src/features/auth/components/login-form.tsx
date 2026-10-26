'use client';

import { loginInputSchema } from '@calmcash/shared';
import { LoaderCircle, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { describeRequestError, fieldErrorsFromApi } from '@/lib/form-errors';
import { LOGIN_NOTICE_PARAM, parseLoginNotice, type LoginNotice } from '@/lib/return-to';

import { useAuth } from '../auth-context';
import { AuthCard } from './auth-card';
import { ResendVerification } from './resend-verification';

const FIELDS = ['email', 'password'] as const;

const NOTICES: Readonly<Record<LoginNotice, string>> = {
  'signed-out': 'You have signed out of CalmCash.',
  'session-ended': 'Your session has ended. Please sign in again to continue.',
};

type Failure = { kind: 'unverified'; email: string } | { kind: 'error'; message: string };

/**
 * Sign-in form. On success the auth state becomes `authenticated` and the surrounding `GuestOnly`
 * takes the user to the page they asked for. Uses `useSearchParams` (wrap in <Suspense>).
 */
export function LoginForm(): ReactNode {
  const { signIn } = useAuth();
  const notice = parseLoginNotice(useSearchParams().get(LOGIN_NOTICE_PARAM));
  const form = useFormFields({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | undefined>();

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    const input = form.validate(loginInputSchema);
    if (input === undefined) {
      return;
    }

    setSubmitting(true);
    try {
      await signIn(input);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === 'EMAIL_NOT_VERIFIED') {
        setFailure({ kind: 'unverified', email: input.email });
      } else {
        form.setErrors(fieldErrorsFromApi(error, FIELDS));
        setFailure({ kind: 'error', message: describeRequestError(error) });
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Sign in to CalmCash"
      description="Welcome back. Your finances are right where you left them."
      footer={
        <>
          New to CalmCash?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {notice !== undefined && failure === undefined && (
        <FormMessage tone="info">{NOTICES[notice]}</FormMessage>
      )}
      {failure?.kind === 'error' && (
        <FormMessage tone="error" title="We could not sign you in">
          {failure.message}
        </FormMessage>
      )}
      {failure?.kind === 'unverified' && (
        <FormMessage tone="info" title="Confirm your email address first">
          <p>
            We sent a confirmation link when you signed up. Open it, then sign in. Need a new one?
          </p>
          <div className="mt-3">
            <ResendVerification email={failure.email} idPrefix="login-resend" />
          </div>
        </FormMessage>
      )}

      <form
        noValidate
        aria-label="Sign in"
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        <FormField id="login-email" label="Email address" error={form.errors.email}>
          {(control) => (
            <Input
              {...control}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              className="h-11"
              value={form.values.email}
              onChange={(event) => {
                form.setValue('email', event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField
          id="login-password"
          label="Password"
          error={form.errors.password}
          labelAction={
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          {(control) => (
            <PasswordInput
              {...control}
              name="password"
              autoComplete="current-password"
              required
              value={form.values.password}
              onChange={(event) => {
                form.setValue('password', event.target.value);
              }}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting}>
          {submitting ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <LogIn aria-hidden="true" />
          )}
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
