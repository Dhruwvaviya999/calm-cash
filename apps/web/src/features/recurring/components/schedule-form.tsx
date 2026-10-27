'use client';

import {
  calendarDateInTimeZone,
  CURRENCIES,
  CURRENCY_CODES,
  type AccountDto,
  type CategoryDto,
  type CurrencyCode,
  type RecurringScheduleItemDto,
} from '@calmcash/shared';
import { LoaderCircle } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { CategorySelect } from '@/features/transactions';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { describeRequestError } from '@/lib/form-errors';
import { createSchedule, updateSchedule } from '@/services/recurring.service';
import { createSubscription, updateSubscription } from '@/services/subscriptions.service';

import { describeFrequency } from '../recurring-presentation';
import {
  buildCreateScheduleInput,
  buildUpdateScheduleInput,
  emptyScheduleFormValues,
  REPEAT_PRESETS,
  scheduleErrorsFromPaths,
  scheduleToFormValues,
  timingOf,
  type ScheduleFormField,
} from '../schedule-form-model';

export type ScheduleFormMode =
  | { kind: 'create'; variant: 'schedule' | 'subscription' }
  | { kind: 'edit'; item: RecurringScheduleItemDto };

export interface ScheduleFormProps {
  mode: ScheduleFormMode;
  accounts: readonly AccountDto[];
  categories: readonly CategoryDto[];
  defaultCurrency: CurrencyCode;
  timeZone: string;
  onSaved: (item: RecurringScheduleItemDto) => void;
  onCancel: () => void;
}

const TYPES = [
  { value: 'expense', label: 'A payment', description: 'Rent, bills, insurance, loans' },
  { value: 'income', label: 'Money in', description: 'Salary, rent received' },
] as const;

/**
 * Creates or edits a recurring schedule (or a subscription, which is always a payment). It is a
 * plan: saving it records nothing, and confirming an occurrence later records the real money.
 */
export function ScheduleForm({
  mode,
  accounts,
  categories,
  defaultCurrency,
  timeZone,
  onSaved,
  onCancel,
}: ScheduleFormProps): ReactNode {
  const editing = mode.kind === 'edit' ? mode.item : undefined;
  const subscription =
    mode.kind === 'edit' ? mode.item.schedule.isSubscription : mode.variant === 'subscription';
  const form = useFormFields(
    editing === undefined
      ? emptyScheduleFormValues(defaultCurrency, timeZone)
      : scheduleToFormValues(editing.schedule),
  );
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const currency = CURRENCY_CODES.find((code) => code === form.values.currency) ?? defaultCurrency;
  const type = form.values.type === 'income' ? 'income' : 'expense';
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const cancelled = editing?.schedule.cancelledAt !== undefined;
  const choosable = accounts.filter(
    (account) => account.status === 'active' || account.id === editing?.schedule.accountId,
  );
  const timing = timingOf(form.values);
  const preview =
    timing.frequency === 'weekly' || timing.frequency === 'monthly' || timing.frequency === 'yearly'
      ? Number.isInteger(timing.interval) && timing.interval > 0 && form.values.startDate !== ''
        ? describeFrequency({
            frequency: timing.frequency,
            interval: timing.interval,
            startDate: form.values.startDate,
          })
        : undefined
      : undefined;

  const setValue = (field: ScheduleFormField, value: string): void => {
    setFailure(undefined);
    form.setValue(field, value);
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setFailure(undefined);
    let save: () => Promise<RecurringScheduleItemDto>;
    if (editing === undefined) {
      const built = buildCreateScheduleInput(
        subscription ? { ...form.values, type: 'expense' } : form.values,
      );
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      const { type: _type, ...rest } = built.input;
      save = subscription ? () => createSubscription(rest) : () => createSchedule(built.input);
    } else {
      const built = buildUpdateScheduleInput(editing.schedule, form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      const changes = built.input;
      if (changes === undefined) {
        onSaved(editing);
        return;
      }
      save = subscription
        ? () => updateSubscription(editing.schedule.id, changes)
        : () => updateSchedule(editing.schedule.id, changes);
    }
    setSubmitting(true);
    try {
      onSaved(await save());
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.details !== undefined) {
        form.setErrors(scheduleErrorsFromPaths(error.details));
      }
      setFailure(describeRequestError(error));
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={
        editing === undefined
          ? subscription
            ? 'Add a subscription'
            : 'Add a recurring payment'
          : 'Edit recurring payment'
      }
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      {!subscription && editing === undefined && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">What repeats?</legend>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((entry) => (
              <label key={entry.value} className="relative min-w-0">
                <input
                  type="radio"
                  name="schedule-type"
                  value={entry.value}
                  checked={form.values.type === entry.value}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setValue('type', entry.value);
                      setValue('categoryId', '');
                    }
                  }}
                  className="peer sr-only"
                />
                <span className="flex h-full cursor-pointer flex-col gap-1 rounded-xl border bg-card p-3 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-muted/60">
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">{entry.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <FormField id="schedule-name" label="Name" error={form.errors.name}>
        {(control) => (
          <Input
            {...control}
            name="name"
            autoComplete="off"
            placeholder={
              subscription ? 'e.g. Netflix' : type === 'income' ? 'e.g. Salary' : 'e.g. Rent'
            }
            className="h-11"
            value={form.values.name}
            onChange={(event) => {
              setValue('name', event.target.value);
            }}
          />
        )}
      </FormField>

      <FormField
        id="schedule-merchant"
        label={
          subscription
            ? 'Provider (optional)'
            : type === 'income'
              ? 'From (optional)'
              : 'Paid to (optional)'
        }
        error={form.errors.merchant}
      >
        {(control) => (
          <Input
            {...control}
            name="merchant"
            autoComplete="off"
            className="h-11"
            value={form.values.merchant}
            onChange={(event) => {
              setValue('merchant', event.target.value);
            }}
          />
        )}
      </FormField>

      <FormField
        id="schedule-account"
        label="Account (optional)"
        error={form.errors.accountId}
        hint="The account the money usually moves through. You can choose another when you record it."
      >
        {(control) => (
          <NativeSelect
            {...control}
            name="accountId"
            disabled={cancelled}
            value={form.values.accountId}
            onChange={(event) => {
              setValue('accountId', event.target.value);
              const account = accounts.find((entry) => entry.id === event.target.value);
              if (account !== undefined) setValue('currency', account.currency);
            }}
          >
            <option value="">Decide when recording</option>
            {choosable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)]">
        <FormField id="schedule-amount" label="Expected amount" error={form.errors.amount}>
          {(control) => (
            <MoneyInput
              {...control}
              name="amount"
              currency={currency}
              disabled={cancelled}
              value={form.values.amount}
              onChange={(event) => {
                setValue('amount', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="schedule-currency" label="Currency" error={form.errors.currency}>
          {(control) => (
            <NativeSelect
              {...control}
              name="currency"
              disabled={form.values.accountId !== '' || cancelled}
              value={form.values.currency}
              onChange={(event) => {
                setValue('currency', event.target.value);
              }}
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} · {CURRENCIES[code].name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <FormField id="schedule-category" label="Category (optional)" error={form.errors.categoryId}>
        {(control) => (
          <CategorySelect
            {...control}
            categories={categories}
            kind={type}
            placeholder="Choose when recording"
            keepId={editing?.schedule.categoryId}
            value={form.values.categoryId}
            onChange={(event) => {
              setValue('categoryId', event.target.value);
            }}
          />
        )}
      </FormField>

      <fieldset
        className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4"
        disabled={cancelled}
      >
        <legend className="px-1 text-sm font-medium">When</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="schedule-repeat" label="Repeats" error={form.errors.frequency}>
            {(control) => (
              <NativeSelect
                {...control}
                name="repeat"
                value={form.values.repeat}
                onChange={(event) => {
                  setValue('repeat', event.target.value);
                }}
              >
                {REPEAT_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="schedule-start"
            label={editing === undefined ? 'First date' : 'Starts (or restarts) on'}
            error={form.errors.startDate}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                name="startDate"
                min="1900-01-01"
                className="h-11"
                value={form.values.startDate}
                onChange={(event) => {
                  setValue('startDate', event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        {form.values.repeat === 'custom' && (
          <div className="grid grid-cols-2 gap-5">
            <FormField id="schedule-interval" label="Every" error={form.errors.interval}>
              {(control) => (
                <Input
                  {...control}
                  name="interval"
                  inputMode="numeric"
                  className="h-11"
                  value={form.values.interval}
                  onChange={(event) => {
                    setValue('interval', event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField id="schedule-frequency" label="Unit" error={undefined}>
              {(control) => (
                <NativeSelect
                  {...control}
                  name="frequency"
                  value={form.values.frequency}
                  onChange={(event) => {
                    setValue('frequency', event.target.value);
                  }}
                >
                  <option value="weekly">weeks</option>
                  <option value="monthly">months</option>
                  <option value="yearly">years</option>
                </NativeSelect>
              )}
            </FormField>
          </div>
        )}
        {preview !== undefined && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {preview}.
            {editing === undefined && form.values.startDate < today
              ? ' Earlier dates will show as overdue until you record or skip them.'
              : ''}
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="schedule-end"
            label="Last date (optional)"
            error={form.errors.endDate}
            hint="Leave empty to keep repeating."
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                name="endDate"
                min={form.values.startDate}
                className="h-11"
                value={form.values.endDate}
                onChange={(event) => {
                  setValue('endDate', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            id="schedule-reminder"
            label="Highlight days before"
            error={form.errors.reminderDays}
            hint="Shown in the app only. No e-mails are sent."
          >
            {(control) => (
              <Input
                {...control}
                name="reminderDays"
                inputMode="numeric"
                className="h-11"
                value={form.values.reminderDays}
                onChange={(event) => {
                  setValue('reminderDays', event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </fieldset>

      <FormField id="schedule-notes" label="Notes (optional)" error={form.errors.notes}>
        {(control) => (
          <Textarea
            {...control}
            name="notes"
            rows={2}
            value={form.values.notes}
            onChange={(event) => {
              setValue('notes', event.target.value);
            }}
          />
        )}
      </FormField>

      {editing !== undefined && (
        <FormMessage tone="info" title="What changes">
          New amounts, accounts, and categories apply to every payment not yet recorded. Recorded
          transactions stay exactly as they are.
        </FormMessage>
      )}

      {failure !== undefined && (
        <FormMessage tone="error" title="Not saved">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-10" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {editing === undefined ? 'Save' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
