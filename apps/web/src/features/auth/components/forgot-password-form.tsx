'use client';

import { forgotPasswordInputSchema, PASSWORD_RESET_TOKEN_TTL_MINUTES } from '@calmcash/shared';
import { KeyRound, LoaderCircle, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormFields } from '@/hooks/use-form-fields';
import { describeRequestError, fieldErrorsFromApi } from '@/lib/form-errors';
import { requestPasswordReset } from '@/services/auth.service';

import { AuthCard } from './auth-card';
import { AuthIcon } from './auth-icon';

const BACK_TO_SIGN_IN = (
  <Link href="/login" className="font-medium text-primary hover:underline">
    Back to sign in
  </Link>
);

/** Requests a reset link. The confirmation never reveals whether the address has an account. */
export function ForgotPasswordForm(): ReactNode {
  const form = useFormFields({ email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [requestedFor, setRequestedFor] = useState<string | undefined>();

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    const input = form.validate(forgotPasswordInputSchema);
    if (input === undefined) {
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(input.email);
      setRequestedFor(input.email);
    } catch (error: unknown) {
      form.setErrors(fieldErrorsFromApi(error, ['email'] as const));
      setFailure(describeRequestError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (requestedFor !== undefined) {
    return (
      <AuthCard
        eyebrow={<AuthIcon icon={MailCheck} tone="success" />}
        title="Check your inbox"
        description={
          <p>
            If an account exists for{' '}
            <span className="font-medium break-all text-foreground">{requestedFor}</span>, we have
            sent it a link to choose a new password. The link works once and expires in{' '}
            {PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.
          </p>
        }
        footer={BACK_TO_SIGN_IN}
      >
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => {
            form.reset();
            setRequestedFor(undefined);
          }}
        >
          Use a different email address
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow={<AuthIcon icon={KeyRound} />}
      title="Reset your password"
      description="Enter the email address you use for CalmCash and we will send you a reset link."
      footer={BACK_TO_SIGN_IN}
    >
      {failure !== undefined && (
        <FormMessage tone="error" title="We could not send the link">
          {failure}
        </FormMessage>
      )}
      <form
        noValidate
        aria-label="Request a password reset"
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        <FormField id="forgot-email" label="Email address" error={form.errors.email}>
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
        <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}
