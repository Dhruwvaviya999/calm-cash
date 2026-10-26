'use client';

import { EMAIL_VERIFICATION_TOKEN_TTL_HOURS, registerInputSchema } from '@calmcash/shared';
import { LoaderCircle, MailCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormFields } from '@/hooks/use-form-fields';
import { describeRequestError, fieldErrorsFromApi } from '@/lib/form-errors';
import { register } from '@/services/auth.service';

import { AuthCard } from './auth-card';
import { AuthIcon } from './auth-icon';
import { PasswordRequirements } from './password-requirements';
import { ResendVerification } from './resend-verification';

const FIELDS = ['name', 'email', 'password', 'passwordConfirmation'] as const;

const SIGN_IN_FOOTER = (
  <>
    Already have an account?{' '}
    <Link href="/login" className="font-medium text-primary hover:underline">
      Sign in
    </Link>
  </>
);

/** Account creation, ending in a "check your inbox" confirmation (no session until verified). */
export function RegisterForm(): ReactNode {
  const form = useFormFields({ name: '', email: '', password: '', passwordConfirmation: '' });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [registeredEmail, setRegisteredEmail] = useState<string | undefined>();

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    const input = form.validate(registerInputSchema);
    if (input === undefined) {
      return;
    }

    setSubmitting(true);
    try {
      const result = await register(input);
      setRegisteredEmail(result.email);
    } catch (error: unknown) {
      form.setErrors(fieldErrorsFromApi(error, FIELDS));
      setFailure(describeRequestError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (registeredEmail !== undefined) {
    return (
      <AuthCard
        eyebrow={<AuthIcon icon={MailCheck} tone="success" />}
        title="Check your inbox"
        description={
          <p>
            We emailed{' '}
            <span className="font-medium break-all text-foreground">{registeredEmail}</span>. Open
            the link in that message to confirm your address — then you can sign in. The link
            expires in {EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.
          </p>
        }
        footer={SIGN_IN_FOOTER}
      >
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>Nothing arrived after a few minutes? Check your spam folder, or ask for a new link.</p>
          <ResendVerification email={registeredEmail} idPrefix="register-resend" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your CalmCash account"
      description="A calm, private place for your money. It takes less than a minute."
      footer={SIGN_IN_FOOTER}
    >
      <form
        noValidate
        aria-label="Create account"
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        {failure !== undefined && (
          <FormMessage tone="error" title="We could not create your account">
            {failure}
          </FormMessage>
        )}

        <FormField id="register-name" label="Your name" error={form.errors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              autoComplete="name"
              required
              className="h-11"
              value={form.values.name}
              onChange={(event) => {
                form.setValue('name', event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField id="register-email" label="Email address" error={form.errors.email}>
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
          id="register-password"
          label="Password"
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
          id="register-password-confirmation"
          label="Confirm password"
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
          {submitting ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          {submitting ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
