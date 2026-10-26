'use client';

import {
  getAccountClassification,
  instantToZonedDateTime,
  parseMinorUnits,
  serializeMinorUnits,
  type AccountWithBalanceDto,
  type ReconciliationPreviewDto,
  type ReconciliationPreviewInput,
  type TransactionListItemDto,
} from '@calmcash/shared';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { getBalanceFigure } from '@/features/accounts';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { ACCOUNT_TYPE_PRESENTATION, describeAdjustmentDirection } from '@/lib/finance-presentation';
import { describeRequestError, type FieldErrors } from '@/lib/form-errors';
import { previewReconciliation, reconcileBalance } from '@/services/transactions.service';

import {
  buildReconciliationInput,
  type ReconcileFormField,
  type ReconcileFormValues,
} from '../transaction-form-model';

export interface ReconcileFormProps {
  /** Active accounts with their current balances. */
  accounts: readonly AccountWithBalanceDto[];
  initialAccountId: string | undefined;
  timeZone: string;
  onSaved: (item: TransactionListItemDto) => void;
  onCancel: () => void;
}

interface Review {
  input: ReconciliationPreviewInput;
  preview: ReconciliationPreviewDto;
}

function errorsFromApi(error: unknown): FieldErrors<ReconcileFormField> {
  const errors: FieldErrors<ReconcileFormField> = {};
  if (!(error instanceof ApiClientError)) {
    return errors;
  }
  for (const detail of error.details ?? []) {
    const key = detail.path.replace(/^body\./, '');
    const field =
      key === 'observedBalanceMinor'
        ? 'observed'
        : key === 'asOf'
          ? 'date'
          : key === 'accountId'
            ? 'accountId'
            : undefined;
    if (field !== undefined) {
      errors[field] ??= detail.message;
    }
  }
  return errors;
}

function Figure({ label, entry }: { label: string; entry: AccountWithBalanceDto }): ReactNode {
  const figure = getBalanceFigure(entry);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <span className="mr-2 text-xs text-muted-foreground">{figure.label}</span>
        <FinancialAmount
          amountMinor={figure.amountMinor}
          currency={entry.account.currency}
          size="sm"
        />
      </dd>
    </div>
  );
}

/**
 * Reconciles an account with the balance its bank, cash count, or statement shows. Step one asks
 * for that balance (or, for a card, the amount owed) and a reason; step two shows the exact
 * correction the API calculated and records it only when confirmed. The opening balance and past
 * transactions are never changed.
 */
export function ReconcileForm({
  accounts,
  initialAccountId,
  timeZone,
  onSaved,
  onCancel,
}: ReconcileFormProps): ReactNode {
  const [initial] = useState<ReconcileFormValues>(() => {
    const { date, time } = instantToZonedDateTime(new Date(), timeZone);
    const only = accounts.length === 1 ? accounts[0]?.account.id : undefined;
    return {
      accountId: initialAccountId ?? only ?? '',
      observed: '',
      date,
      time,
      description: '',
      notes: '',
    };
  });
  const form = useFormFields(initial);
  const [review, setReview] = useState<Review | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const entry = accounts.find((candidate) => candidate.account.id === form.values.accountId);
  const owed = entry !== undefined && getAccountClassification(entry.account.type) === 'liability';

  const setValue = (field: ReconcileFormField, value: string): void => {
    setFailure(undefined);
    form.setValue(field, value);
  };

  const runPreview = async (input: ReconciliationPreviewInput): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      setReview({ input, preview: await previewReconciliation(input) });
    } catch (error: unknown) {
      form.setErrors(errorsFromApi(error));
      setFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleReview = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const built = buildReconciliationInput(
      form.values,
      accounts.map((candidate) => candidate.account),
      timeZone,
    );
    if (!built.ok) {
      form.setErrors(built.errors);
      return;
    }
    void runPreview(built.input);
  };

  const confirm = async (current: Review): Promise<void> => {
    const { adjustment } = current.preview;
    if (busy || adjustment === undefined) {
      return;
    }
    const magnitude = parseMinorUnits(adjustment.amountMinor);
    setBusy(true);
    setFailure(undefined);
    try {
      const notes = form.values.notes.trim();
      onSaved(
        await reconcileBalance(
          {
            ...current.input,
            description: form.values.description,
            ...(notes === '' ? {} : { notes }),
            expectedAdjustmentMinor: serializeMinorUnits(
              adjustment.direction === 'increase' ? magnitude : -magnitude,
            ),
          },
          idempotencyKey,
        ),
      );
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
      setBusy(false);
    }
  };

  if (review !== undefined && entry !== undefined) {
    const { preview } = review;
    const classification = getAccountClassification(entry.account.type);
    return (
      <section aria-label="Review the adjustment" className="flex flex-col gap-5">
        <div>
          <h3 className="font-semibold">{entry.account.name}</h3>
          <p className="text-sm text-muted-foreground">
            As of {formatDateTime(preview.asOf, timeZone)}
          </p>
        </div>
        <dl className="divide-y border-y">
          <Figure label="CalmCash shows" entry={{ ...entry, balance: preview.before }} />
          <Figure label="You checked" entry={{ ...entry, balance: preview.after }} />
        </dl>
        {preview.adjustment === undefined ? (
          <FormMessage tone="success" title="Already in step">
            The balances match, so there is nothing to correct.
          </FormMessage>
        ) : (
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">Adjustment to record</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-medium">
              {describeAdjustmentDirection(preview.adjustment.direction, classification)} by
              <FinancialAmount
                amountMinor={preview.adjustment.amountMinor}
                currency={preview.currency}
                size="lg"
              />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Reason: {form.values.description.trim()}. It is not income or spending, and your
              opening balance and past transactions stay exactly as they are.
            </p>
          </div>
        )}

        {failure !== undefined && (
          <FormMessage tone="error" title="Nothing was recorded">
            {failure}
          </FormMessage>
        )}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={busy}
            onClick={() => {
              setReview(undefined);
              setFailure(undefined);
            }}
          >
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
          {preview.adjustment === undefined ? (
            <Button type="button" className="h-11 sm:h-9" onClick={onCancel}>
              Done
            </Button>
          ) : failure !== undefined ? (
            <Button
              type="button"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => void runPreview(review.input)}
            >
              Review again
            </Button>
          ) : (
            <Button
              type="button"
              className="h-11 sm:h-9"
              disabled={busy}
              aria-disabled={busy}
              onClick={() => void confirm(review)}
            >
              {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {busy ? 'Recording…' : 'Record adjustment'}
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <form
      noValidate
      aria-label="Correct a balance"
      onSubmit={handleReview}
      className="flex flex-col gap-5"
    >
      <FormField id="reconcile-account" label="Account" error={form.errors.accountId}>
        {(control) => (
          <NativeSelect
            {...control}
            name="accountId"
            value={form.values.accountId}
            onChange={(event) => {
              setValue('accountId', event.target.value);
            }}
          >
            <option value="">Choose an account</option>
            {accounts.map((candidate) => (
              <option key={candidate.account.id} value={candidate.account.id}>
                {candidate.account.name} · {ACCOUNT_TYPE_PRESENTATION[candidate.account.type].label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      {entry !== undefined && (
        <p className="rounded-xl border border-dashed bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          CalmCash shows {getBalanceFigure(entry).label.toLowerCase()}{' '}
          <FinancialAmount
            amountMinor={getBalanceFigure(entry).amountMinor}
            currency={entry.account.currency}
            size="sm"
            className="text-foreground"
          />{' '}
          right now.
        </p>
      )}

      <FormField
        id="reconcile-observed"
        label={
          owed ? 'Amount you owe, per your statement or app' : 'Balance your bank or count shows'
        }
        error={form.errors.observed}
        hint={
          owed
            ? 'Enter what you owe as a positive amount. Use a minus sign if the card is in credit.'
            : 'Exactly as shown, e.g. 12,500.50.'
        }
      >
        {(control) => (
          <MoneyInput
            {...control}
            name="observed"
            currency={entry?.account.currency ?? 'INR'}
            value={form.values.observed}
            onChange={(event) => {
              setValue('observed', event.target.value);
            }}
          />
        )}
      </FormField>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-3">
        <FormField id="reconcile-date" label="As of" error={form.errors.date}>
          {(control) => (
            <Input
              {...control}
              name="date"
              type="date"
              className="h-11"
              value={form.values.date}
              onChange={(event) => {
                setValue('date', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="reconcile-time" label="Time" error={form.errors.time}>
          {(control) => (
            <Input
              {...control}
              name="time"
              type="time"
              className="h-11"
              value={form.values.time}
              onChange={(event) => {
                setValue('time', event.target.value);
              }}
            />
          )}
        </FormField>
      </div>

      <FormField id="reconcile-reason" label="Reason" error={form.errors.description}>
        {(control) => (
          <Input
            {...control}
            name="description"
            autoComplete="off"
            placeholder="e.g. Matched to bank statement"
            className="h-11"
            value={form.values.description}
            onChange={(event) => {
              setValue('description', event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField id="reconcile-notes" label="Notes (optional)">
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

      {failure !== undefined && (
        <FormMessage tone="error" title="The balance could not be checked">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={busy} aria-disabled={busy}>
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {busy ? 'Checking…' : 'Review adjustment'}
        </Button>
      </div>
    </form>
  );
}
