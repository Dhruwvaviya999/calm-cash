'use client';

import { CURRENCIES, CURRENCY_CODES, updateProfileInputSchema } from '@calmcash/shared';
import { LoaderCircle, LocateFixed } from 'lucide-react';
import { useMemo, useState, type SubmitEvent, type ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useAuth, useSignedInSession } from '@/features/auth';
import { useFormFields } from '@/hooks/use-form-fields';
import { describeRequestError, fieldErrorsFromApi } from '@/lib/form-errors';
import { updateProfile } from '@/services/auth.service';

const FIELDS = ['name', 'preferredCurrency', 'timezone'] as const;

type Feedback = { kind: 'saved' } | { kind: 'failed'; message: string } | undefined;

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Every IANA zone the browser knows, always including the currently saved one. */
function timeZoneOptions(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  zones.add('UTC');
  zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
}

/**
 * The signed-in user's profile: display name, preferred currency, and time zone, saved to the
 * API. The e-mail address is shown read-only; changing it needs its own verification flow.
 */
export function ProfileSettings(): ReactNode {
  const { user } = useSignedInSession();
  const { updateUser } = useAuth();
  const saved = {
    name: user.name,
    preferredCurrency: user.preferredCurrency,
    timezone: user.timezone,
  };
  const form = useFormFields(saved);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const zones = useMemo(() => timeZoneOptions(user.timezone), [user.timezone]);
  const detectedZone = useMemo(() => deviceTimeZone(), []);

  const dirty = FIELDS.some((field) => form.values[field] !== saved[field]);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFeedback(undefined);
    const input = form.validate(updateProfileInputSchema);
    if (input === undefined) {
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProfile(input);
      updateUser(updated);
      form.reset({
        name: updated.name,
        preferredCurrency: updated.preferredCurrency,
        timezone: updated.timezone,
      });
      setFeedback({ kind: 'saved' });
    } catch (error: unknown) {
      form.setErrors(fieldErrorsFromApi(error, FIELDS));
      setFeedback({ kind: 'failed', message: describeRequestError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <form
        noValidate
        aria-label="Profile"
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        <FormField id="profile-name" label="Display name" error={form.errors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              autoComplete="name"
              className="h-11"
              value={form.values.name}
              onChange={(event) => {
                setFeedback(undefined);
                form.setValue('name', event.target.value);
              }}
            />
          )}
        </FormField>

        <div className="flex flex-col gap-1.5">
          <span id="profile-email-label" className="text-sm font-medium">
            Email address
          </span>
          <div
            aria-labelledby="profile-email-label"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
          >
            <span className="min-w-0 break-all">{user.email}</span>
            {user.emailVerifiedAt === undefined ? (
              <StatusBadge tone="warning">Not verified</StatusBadge>
            ) : (
              <StatusBadge tone="positive">Verified</StatusBadge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Your email address is used to sign in and cannot be changed here yet.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="profile-currency"
            label="Preferred currency"
            error={form.errors.preferredCurrency}
            hint="Used for new accounts and summaries."
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="preferredCurrency"
                value={form.values.preferredCurrency}
                onChange={(event) => {
                  setFeedback(undefined);
                  form.setValue('preferredCurrency', event.target.value);
                }}
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {CURRENCIES[code].name} ({code})
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>

          <FormField
            id="profile-timezone"
            label="Time zone"
            error={form.errors.timezone}
            hint={
              detectedZone !== undefined && detectedZone !== form.values.timezone ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                  onClick={() => {
                    setFeedback(undefined);
                    form.setValue('timezone', detectedZone);
                  }}
                >
                  <LocateFixed aria-hidden="true" className="size-4" />
                  Use this device&apos;s time zone ({detectedZone.replaceAll('_', ' ')})
                </button>
              ) : (
                'Dates and reports follow this time zone.'
              )
            }
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="timezone"
                value={form.values.timezone}
                onChange={(event) => {
                  setFeedback(undefined);
                  form.setValue('timezone', event.target.value);
                }}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>

        {feedback?.kind === 'saved' && (
          <FormMessage tone="success">Your profile was saved.</FormMessage>
        )}
        {feedback?.kind === 'failed' && (
          <FormMessage tone="error" title="Your changes were not saved">
            {feedback.message}
          </FormMessage>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={!dirty || saving}
            onClick={() => {
              setFeedback(undefined);
              form.reset(saved);
            }}
          >
            Discard changes
          </Button>
          <Button type="submit" className="h-11 sm:h-9" disabled={!dirty || saving}>
            {saving && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
