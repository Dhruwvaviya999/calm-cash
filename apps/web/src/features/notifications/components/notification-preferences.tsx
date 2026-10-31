'use client';

import {
  NOTIFICATION_CATEGORIES,
  REMINDER_LEAD_DAYS,
  reminderLeadDaysSchema,
  type NotificationCategory,
  type NotificationChannelsByCategoryDto,
  type NotificationPreferencesDto,
  type ReminderLeadDays,
} from '@calmcash/shared';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useState, type ReactNode, type SubmitEvent } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@/services/notifications.service';

export const CATEGORY_TEXT: Readonly<
  Record<NotificationCategory, { title: string; description: string }>
> = {
  budget_alerts: {
    title: 'Budget alerts',
    description:
      'When spending in a budget reaches one of its alert thresholds, or its limit. Each alert is sent once per budget period.',
  },
  upcoming_payments: {
    title: 'Upcoming bills',
    description:
      'A few days before a recurring bill is due, and on the day it is due. A reminder never records or pays anything.',
  },
  overdue_payments: {
    title: 'Overdue bills',
    description:
      'Once, if a bill passes its due date without being recorded, skipped, or postponed (within a week of the date).',
  },
  subscription_renewals: {
    title: 'Subscription renewals',
    description:
      'Before a subscription is expected to renew. The amount is an estimate from your subscription details, not a charge.',
  },
  monthly_summary: {
    title: 'Monthly summary',
    description:
      'Early each month: last month’s income, spending, net, and savings rate, one summary per currency.',
  },
};

interface Draft {
  channels: NotificationChannelsByCategoryDto;
  paymentLeadDays: ReminderLeadDays;
  subscriptionLeadDays: ReminderLeadDays;
  includeRecurringIncome: boolean;
}

type Feedback = { kind: 'saved' } | { kind: 'failed'; message: string } | undefined;

function draftOf(preferences: NotificationPreferencesDto): Draft {
  return {
    channels: preferences.channels,
    paymentLeadDays: preferences.paymentLeadDays,
    subscriptionLeadDays: preferences.subscriptionLeadDays,
    includeRecurringIncome: preferences.includeRecurringIncome,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function leadDaysLabel(days: ReminderLeadDays): string {
  return days === 1 ? '1 day before' : `${days.toString()} days before`;
}

function Checkbox({
  id,
  label,
  accessibleName,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: ReactNode;
  /** A fuller name for assistive technology, starting with the visible label. */
  accessibleName?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60 sm:min-h-8"
    >
      <input
        id={id}
        type="checkbox"
        aria-label={accessibleName}
        className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}

function PreferencesForm({
  saved,
  onSaved,
}: {
  saved: NotificationPreferencesDto;
  onSaved: (preferences: NotificationPreferencesDto) => void;
}): ReactNode {
  const { user } = useSignedInSession();
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const dirty = !sameDraft(draft, draftOf(saved));
  const emailAllowed = saved.email.verified;

  const update = (change: (current: Draft) => Draft): void => {
    setFeedback(undefined);
    setDraft(change);
  };

  const setChannel = (
    category: NotificationCategory,
    channel: 'inApp' | 'email',
    on: boolean,
  ): void => {
    update((current) => ({
      ...current,
      channels: {
        ...current.channels,
        [category]: { ...current.channels[category], [channel]: on },
      },
    }));
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setFeedback(undefined);
    try {
      const updated = await updateNotificationPreferences(draft);
      onSaved(updated);
      setDraft(draftOf(updated));
      setFeedback({ kind: 'saved' });
    } catch (error: unknown) {
      setFeedback({ kind: 'failed', message: describeRequestError(error) });
    } finally {
      setSaving(false);
    }
  };

  const leadSelect = (
    id: string,
    label: string,
    value: ReminderLeadDays,
    onChange: (days: ReminderLeadDays) => void,
  ): ReactNode => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        value={String(value)}
        onChange={(event) => {
          const parsed = reminderLeadDaysSchema.safeParse(Number(event.target.value));
          if (parsed.success) onChange(parsed.data);
        }}
      >
        {REMINDER_LEAD_DAYS.map((days) => (
          <option key={days} value={String(days)}>
            {leadDaysLabel(days)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <form
      noValidate
      aria-label="Notification preferences"
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2 text-sm">
        {saved.automation.status === 'running' ? (
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="positive">Reminders are running</StatusBadge>
            <span className="text-muted-foreground">
              Background service last checked in{' '}
              {formatDateTime(saved.automation.lastSeenAt, user.timezone)}.
            </span>
          </p>
        ) : (
          <FormMessage tone="info" title="Reminders are paused">
            CalmCash’s background service is not running, so no new reminders, alerts, summaries, or
            e-mails are being created. They resume when it starts again; your choices here are saved
            either way.
          </FormMessage>
        )}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground">E-mails go to</span>
          <span className="break-all">{saved.email.address}</span>
          {emailAllowed ? (
            <StatusBadge tone="positive">Verified</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Not verified</StatusBadge>
          )}
        </p>
        {!emailAllowed && (
          <p className="text-muted-foreground">
            E-mail notifications need a verified address. Confirm your address from the link we sent
            you; until then, notifications appear in the app only.
          </p>
        )}
      </div>

      <div className="flex flex-col divide-y rounded-xl border">
        {NOTIFICATION_CATEGORIES.map((category) => {
          const text = CATEGORY_TEXT[category];
          const channels = draft.channels[category];
          return (
            <fieldset
              key={category}
              className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6"
            >
              <div className="min-w-0">
                <legend className="font-medium">{text.title}</legend>
                <p className="mt-1 text-sm text-muted-foreground">{text.description}</p>
                {category === 'upcoming_payments' && (
                  <div className="mt-2">
                    <Checkbox
                      id="notify-include-income"
                      label="Also remind me about expected income"
                      checked={draft.includeRecurringIncome}
                      onChange={(on) => {
                        update((current) => ({ ...current, includeRecurringIncome: on }));
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-4 sm:flex-col sm:gap-0">
                <Checkbox
                  id={`notify-${category}-in-app`}
                  label="In the app"
                  accessibleName={`In the app: ${text.title}`}
                  checked={channels.inApp}
                  onChange={(on) => {
                    setChannel(category, 'inApp', on);
                  }}
                />
                <Checkbox
                  id={`notify-${category}-email`}
                  label="By e-mail"
                  accessibleName={`By e-mail: ${text.title}`}
                  checked={channels.email && emailAllowed}
                  disabled={!emailAllowed}
                  onChange={(on) => {
                    setChannel(category, 'email', on);
                  }}
                />
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {leadSelect(
          'notify-payment-lead',
          'Remind me about bills',
          draft.paymentLeadDays,
          (days) => {
            update((current) => ({ ...current, paymentLeadDays: days }));
          },
        )}
        {leadSelect(
          'notify-subscription-lead',
          'Remind me about subscription renewals',
          draft.subscriptionLeadDays,
          (days) => {
            update((current) => ({ ...current, subscriptionLeadDays: days }));
          },
        )}
      </div>

      {feedback?.kind === 'saved' && (
        <FormMessage tone="success">Your notification preferences were saved.</FormMessage>
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
            setDraft(draftOf(saved));
          }}
        >
          Discard changes
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={!dirty || saving}>
          {saving && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {saving ? 'Saving…' : 'Save notification preferences'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Settings → Notifications: what CalmCash tells you about, in the app and by e-mail, and how far
 * ahead. Defaults: everything in the app, nothing by e-mail, three days' notice.
 */
export function NotificationPreferences(): ReactNode {
  const { state, reload } = useAsyncResource(
    useCallback((signal: AbortSignal) => getNotificationPreferences(signal), []),
  );
  const [saved, setSaved] = useState<NotificationPreferencesDto | undefined>();

  return (
    <Card className="p-5 sm:p-6">
      {state.status === 'loading' && (
        <div role="status">
          <span className="sr-only">Loading notification preferences…</span>
          <ListSkeleton rows={4} />
        </div>
      )}
      {state.status === 'error' && (
        <ErrorState
          title="Notification preferences could not be loaded"
          description={describeRequestError(state.error)}
          onRetry={reload}
        />
      )}
      {state.status === 'success' && (
        <PreferencesForm saved={saved ?? state.data} onSaved={setSaved} />
      )}
    </Card>
  );
}
