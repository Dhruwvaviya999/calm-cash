'use client';

import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  describeDecimalAmountError,
  formatDecimalAmount,
  instantToZonedDateTime,
  isWallClockTime,
  MAX_POSTPONE_DAYS,
  parseDecimalAmount,
  parseMinorUnits,
  zonedDateTimeToInstant,
  type AccountDto,
  type CategoryDto,
  type OccurrenceActionResultDto,
  type RecordedOccurrenceDto,
  type UpcomingOccurrenceDto,
} from '@calmcash/shared';
import { LoaderCircle } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { CategorySelect } from '@/features/transactions';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { describeRequestError, fieldErrorsFromApi } from '@/lib/form-errors';
import { postponeOccurrence, recordOccurrence } from '@/services/recurring.service';

type RecordField = 'accountId' | 'amount' | 'date' | 'time' | 'categoryId' | 'notes';

export interface RecordOccurrenceFormProps {
  target: UpcomingOccurrenceDto;
  accounts: readonly AccountDto[];
  categories: readonly CategoryDto[];
  timeZone: string;
  onRecorded: (result: RecordedOccurrenceDto) => void;
  onCancel: () => void;
}

/**
 * Confirms that an expected payment happened and records it as a real transaction, through the
 * same rules as any other entry (account, balance, and date checks). Every field starts from the
 * schedule; the person can correct the amount, account, or date to what actually happened.
 */
export function RecordOccurrenceForm({
  target,
  accounts,
  categories,
  timeZone,
  onRecorded,
  onCancel,
}: RecordOccurrenceFormProps): ReactNode {
  const { occurrence, schedule } = target;
  const now = instantToZonedDateTime(new Date(), timeZone);
  const date = occurrence.dueDate < now.date ? occurrence.dueDate : now.date;
  const choosable = accounts.filter(
    (account) => account.status === 'active' && account.currency === schedule.currency,
  );
  const preferred = choosable.find((account) => account.id === schedule.accountId);
  const form = useFormFields({
    accountId: preferred?.id ?? (choosable.length === 1 ? (choosable[0]?.id ?? '') : ''),
    amount: formatDecimalAmount(parseMinorUnits(occurrence.amountMinor), occurrence.currency),
    date,
    time: date === now.date ? now.time : '12:00',
    categoryId: schedule.categoryId ?? '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const account = choosable.find((entry) => entry.id === form.values.accountId);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setFailure(undefined);
    const errors: Partial<Record<RecordField, string>> = {};
    if (form.values.accountId === '')
      errors.accountId = 'Choose the account the money moved through.';
    if (form.values.categoryId === '') errors.categoryId = 'Choose a category.';
    const amount = parseDecimalAmount(form.values.amount, occurrence.currency);
    if (!amount.ok) errors.amount = describeDecimalAmountError(amount.error, occurrence.currency);
    else if (amount.minorUnits <= 0n) errors.amount = 'Enter an amount above zero.';
    if (form.values.date === '' || form.values.date > now.date) {
      errors.date = 'Choose today or an earlier day: only money that already moved is recorded.';
    }
    if (!isWallClockTime(form.values.time)) errors.time = 'Enter a time such as 09:30.';
    if (Object.keys(errors).length > 0 || !amount.ok) {
      form.setErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      onRecorded(
        await recordOccurrence(occurrence.scheduleId, occurrence.scheduledDate, {
          accountId: form.values.accountId,
          categoryId: form.values.categoryId,
          amountMinor: amount.minorUnits.toString(),
          occurredAt: zonedDateTimeToInstant(
            form.values.date,
            form.values.time,
            timeZone,
          ).toISOString(),
          ...(form.values.notes.trim() === '' ? {} : { notes: form.values.notes }),
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ApiClientError) {
        const fields = fieldErrorsFromApi(error, ['accountId', 'categoryId', 'notes']);
        const amountError = error.details?.find((detail) => detail.path === 'body.amountMinor');
        const dateError = error.details?.find((detail) => detail.path === 'body.occurredAt');
        form.setErrors({
          ...fields,
          ...(amountError === undefined ? {} : { amount: amountError.message }),
          ...(dateError === undefined ? {} : { date: dateError.message }),
        });
      }
      setFailure(describeRequestError(error));
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={`Record ${schedule.name}`}
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      <FormMessage tone="info" title="This records real money">
        Recording adds a {schedule.type === 'income' ? 'credit' : 'debit'} of{' '}
        {formatMoney(occurrence.amountMinor, occurrence.currency)} to{' '}
        {account?.name ?? 'the account you choose'} and updates its balance. It was due{' '}
        {formatDate(occurrence.dueDate, 'dayMonthYear')}.
      </FormMessage>

      {choosable.length === 0 ? (
        <FormMessage tone="error" title="No account to record it in">
          Add an active account in {schedule.currency} first.
        </FormMessage>
      ) : (
        <FormField id="record-account" label="Account" error={form.errors.accountId}>
          {(control) => (
            <NativeSelect
              {...control}
              value={form.values.accountId}
              onChange={(event) => {
                form.setValue('accountId', event.target.value);
              }}
            >
              <option value="">Choose an account</option>
              {choosable.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}

      <FormField
        id="record-amount"
        label="Amount"
        error={form.errors.amount}
        hint="Change it if the actual amount was different."
      >
        {(control) => (
          <MoneyInput
            {...control}
            currency={occurrence.currency}
            value={form.values.amount}
            onChange={(event) => {
              form.setValue('amount', event.target.value);
            }}
          />
        )}
      </FormField>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-4">
        <FormField id="record-date" label="Date" error={form.errors.date}>
          {(control) => (
            <Input
              {...control}
              type="date"
              max={now.date}
              className="h-11"
              value={form.values.date}
              onChange={(event) => {
                form.setValue('date', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="record-time" label="Time" error={form.errors.time}>
          {(control) => (
            <Input
              {...control}
              type="time"
              className="h-11"
              value={form.values.time}
              onChange={(event) => {
                form.setValue('time', event.target.value);
              }}
            />
          )}
        </FormField>
      </div>

      <FormField id="record-category" label="Category" error={form.errors.categoryId}>
        {(control) => (
          <CategorySelect
            {...control}
            categories={categories}
            kind={schedule.type}
            placeholder="Choose a category"
            value={form.values.categoryId}
            onChange={(event) => {
              form.setValue('categoryId', event.target.value);
            }}
          />
        )}
      </FormField>

      <FormField id="record-notes" label="Note (optional)" error={form.errors.notes}>
        {(control) => (
          <Input
            {...control}
            className="h-11"
            value={form.values.notes}
            onChange={(event) => {
              form.setValue('notes', event.target.value);
            }}
          />
        )}
      </FormField>

      {failure !== undefined && (
        <FormMessage tone="error" title="Nothing was recorded">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 sm:h-10"
          disabled={submitting || choosable.length === 0}
        >
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          Record {schedule.type === 'income' ? 'income' : 'payment'}
        </Button>
      </div>
    </form>
  );
}

export interface PostponeFormProps {
  target: UpcomingOccurrenceDto;
  timeZone: string;
  onPostponed: (result: OccurrenceActionResultDto) => void;
  onCancel: () => void;
}

/** Moves an expected payment's due date later. Its identity (scheduled date) never changes. */
export function PostponeForm({
  target,
  timeZone,
  onPostponed,
  onCancel,
}: PostponeFormProps): ReactNode {
  const { occurrence } = target;
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const earliest = addDaysToIsoDate(occurrence.dueDate > today ? occurrence.dueDate : today, 1);
  const latest = addDaysToIsoDate(occurrence.scheduledDate, MAX_POSTPONE_DAYS);
  const [dueDate, setDueDate] = useState(addDaysToIsoDate(earliest, 6));
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    if (dueDate === '' || dueDate <= occurrence.dueDate) {
      setError('Choose a date after the current due date.');
      return;
    }
    setSubmitting(true);
    try {
      onPostponed(
        await postponeOccurrence(occurrence.scheduleId, occurrence.scheduledDate, dueDate),
      );
    } catch (failure: unknown) {
      setError(describeRequestError(failure));
      setSubmitting(false);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Currently due {formatDate(occurrence.dueDate, 'dayMonthYear')}. Postponing changes only this
        payment; the schedule keeps its dates.
      </p>
      <FormField id="postpone-date" label="New due date" error={error}>
        {(control) => (
          <Input
            {...control}
            type="date"
            min={earliest}
            max={latest}
            className="h-11"
            value={dueDate}
            onChange={(event) => {
              setError(undefined);
              setDueDate(event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-10" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          Postpone
        </Button>
      </div>
    </form>
  );
}
