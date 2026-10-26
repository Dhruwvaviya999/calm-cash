'use client';

import { changePasswordInputSchema } from '@calmcash/shared';
import { LoaderCircle } from 'lucide-react';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { PasswordInput } from '@/components/forms/password-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordRequirements, useAuth, useSignedInSession } from '@/features/auth';
import { useFormFields } from '@/hooks/use-form-fields';
import { describeRequestError, fieldErrorsFromApi, hasFieldErrors } from '@/lib/form-errors';
import { changePassword } from '@/services/auth.service';

const FIELDS = ['currentPassword', 'newPassword', 'newPasswordConfirmation'] as const;
const EMPTY = { currentPassword: '', newPassword: '', newPasswordConfirmation: '' };

type Field = (typeof FIELDS)[number];

interface FieldBinding {
  name: Field;
  required: true;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
}

type Feedback = { kind: 'changed' } | { kind: 'failed'; message: string } | undefined;

/**
 * Changes the password. The API keeps this device signed in with a fresh session and signs out
 * every other device.
 */
export function ChangePasswordForm(): ReactNode {
  const { replaceSession } = useAuth();
  const { user } = useSignedInSession();
  const form = useFormFields(EMPTY);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFeedback(undefined);
    const input = form.validate(changePasswordInputSchema);
    if (input === undefined) {
      return;
    }
    setSaving(true);
    try {
      replaceSession(await changePassword(input));
      form.reset(EMPTY);
      setFeedback({ kind: 'changed' });
    } catch (error: unknown) {
      const fieldErrors = fieldErrorsFromApi(error, FIELDS);
      form.setErrors(fieldErrors);
      if (!hasFieldErrors(fieldErrors)) {
        setFeedback({ kind: 'failed', message: describeRequestError(error) });
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (name: Field): FieldBinding => ({
    name,
    required: true,
    value: form.values[name],
    onChange: (event: { target: { value: string } }) => {
      setFeedback(undefined);
      form.setValue(name, event.target.value);
    },
  });

  return (
    <Card className="p-5 sm:p-6">
      <form
        noValidate
        aria-label="Change password"
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        {/* Lets password managers associate the change with the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user.email}
          readOnly
          hidden
        />
        <FormField
          id="password-current"
          label="Current password"
          error={form.errors.currentPassword}
        >
          {(control) => (
            <PasswordInput
              {...control}
              {...field('currentPassword')}
              autoComplete="current-password"
            />
          )}
        </FormField>
        <FormField
          id="password-new"
          label="New password"
          error={form.errors.newPassword}
          hint={<PasswordRequirements password={form.values.newPassword} />}
        >
          {(control) => (
            <PasswordInput {...control} {...field('newPassword')} autoComplete="new-password" />
          )}
        </FormField>
        <FormField
          id="password-confirmation"
          label="Confirm new password"
          error={form.errors.newPasswordConfirmation}
        >
          {(control) => (
            <PasswordInput
              {...control}
              {...field('newPasswordConfirmation')}
              autoComplete="new-password"
            />
          )}
        </FormField>

        {feedback?.kind === 'changed' && (
          <FormMessage tone="success" title="Password changed">
            You are still signed in here. Every other device has been signed out.
          </FormMessage>
        )}
        {feedback?.kind === 'failed' && (
          <FormMessage tone="error" title="Your password was not changed">
            {feedback.message}
          </FormMessage>
        )}

        <div className="flex sm:justify-end">
          <Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={saving}>
            {saving && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {saving ? 'Changing password…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
