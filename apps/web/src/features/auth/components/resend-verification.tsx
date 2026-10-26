'use client';

import { resendVerificationInputSchema } from '@calmcash/shared';
import { LoaderCircle, Send } from 'lucide-react';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormFields } from '@/hooks/use-form-fields';
import { describeRequestError } from '@/lib/form-errors';
import { resendVerificationEmail } from '@/services/auth.service';

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; message: string };

export interface ResendVerificationProps {
  /** Known address (after registration or a sign-in attempt); otherwise the user types it. */
  email?: string;
  idPrefix?: string;
}

/**
 * Requests a fresh confirmation link. The answer is deliberately the same whether or not the
 * address is registered or already confirmed.
 */
export function ResendVerification({
  email,
  idPrefix = 'resend',
}: ResendVerificationProps): ReactNode {
  const form = useFormFields({ email: email ?? '' });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const input = form.validate(resendVerificationInputSchema);
    if (input === undefined) {
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      await resendVerificationEmail(input.email);
      setStatus({ kind: 'sent' });
    } catch (error: unknown) {
      setStatus({ kind: 'failed', message: describeRequestError(error) });
    }
  };

  if (status.kind === 'sent') {
    return (
      <FormMessage tone="success" title="Request received">
        If that address is waiting to be confirmed, a new link is on its way. It can take a minute
        to arrive — check your spam folder too.
      </FormMessage>
    );
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
      {status.kind === 'failed' && (
        <FormMessage tone="error" title="The link could not be requested">
          {status.message}
        </FormMessage>
      )}
      {email === undefined && (
        <FormField id={`${idPrefix}-email`} label="Email address" error={form.errors.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              className="h-11"
              value={form.values.email}
              onChange={(event) => {
                form.setValue('email', event.target.value);
              }}
            />
          )}
        </FormField>
      )}
      <Button
        type="submit"
        variant="outline"
        className="h-11 w-full"
        disabled={status.kind === 'sending'}
      >
        {status.kind === 'sending' ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Send aria-hidden="true" />
        )}
        {status.kind === 'sending' ? 'Sending…' : 'Send a new confirmation link'}
      </Button>
    </form>
  );
}
