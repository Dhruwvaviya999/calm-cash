'use client';

import { AUTH_TOKEN_PATTERN, resetPasswordInputSchema } from '@calmcash/shared';
import { CircleCheck, KeyRound, LinkIcon, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { describeRequestError, fieldErrorsFromApi } from '@/lib/form-errors';
import { resetPassword } from '@/services/auth.service';

import { useAuth } from '../auth-context';
import { useLinkToken } from '../use-link-token';
import { AuthCard } from './auth-card';
import { AuthIcon } from './auth-icon';
import { PasswordRequirements } from './password-requirements';

const FIELDS = ['password', 'passwordConfirmation'] as const;

type Outcome = 'form' | 'done' | 'invalid-link';

const REQUEST_NEW_LINK = (
  <Button asChild size="lg" className="h-11 w-full">
    <Link href="/forgot-password">Request a new link</Link>
  </Button>
);

/**
 * Chooses a new password with the token from the e-mailed link. On success every session of the
 * account has been revoked, so the user signs in again with the new password.
 * Uses `useSearchParams` (wrap in <Suspense>).
 */
export function ResetPasswordForm(): ReactNode {
  const { endSession } = useAuth();
  const { token, forget } = useLinkToken();
  const form = useFormFields({ password: '', passwordConfirmation: '' });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<Outcome>(
    token !== null && AUTH_TOKEN_PATTERN.test(token) ? 'form' : 'invalid-link',
  );

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    if (token === null) {
      return;
    }
    const input = form.validate(resetPasswordInputSchema, { token });
    if (input === undefined) {
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(input);
      forget();
      endSession('anonymous');
      setOutcome('done');
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === 'INVALID_TOKEN') {
        forget();
        setOutcome('invalid-link');
      } else {
        form.setErrors(fieldErrorsFromApi(error, FIELDS));
        setFailure(describeRequestError(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (outcome === 'done') {
    return (
      <AuthCard
        eyebrow={<AuthIcon icon={CircleCheck} tone="success" />}
        title="Your password has been changed"
        description="For your security, every device that was signed in has been signed out. Sign in again with your new password."
      >
        <Button asChild size="lg" className="h-11 w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (outcome === 'invalid-link') {
    return (
      <AuthCard
        eyebrow={<AuthIcon icon={LinkIcon} tone="warning" />}
        title="This reset link cannot be used"
        description="It may be incomplete, it may have expired, or it may already have been used. Reset links work once and only for a short time — request a new one and use the newest email."
        footer={
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        {REQUEST_NEW_LINK}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow={<AuthIcon icon={KeyRound} />}
      title="Choose a new password"
      description="Pick something you have not used here before. Afterwards, you will sign in again on every device."
    >
      {failure !== undefined && (
        <FormMessage tone="error" title="We could not change your password">
          {failure}
        </FormMessage>
      )}
      <form
        noValidate
        aria-label="Choose a new password"
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        <FormField
          id="reset-password"
          label="New password"
          error={form.errors.password}
          hint={<PasswordRequirements password={form.values.password} />}
        >
          {(control) => (
            <PasswordInput
              {...control}
              name="password"
              autoComplete="new-password"
              required
              value={form.values.password}
              onChange={(event) => {
                form.setValue('password', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          id="reset-password-confirmation"
          label="Confirm new password"
          error={form.errors.passwordConfirmation}
        >
          {(control) => (
            <PasswordInput
              {...control}
              name="passwordConfirmation"
              autoComplete="new-password"
              required
              value={form.values.passwordConfirmation}
              onChange={(event) => {
                form.setValue('passwordConfirmation', event.target.value);
              }}
            />
          )}
        </FormField>
        <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {submitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}
