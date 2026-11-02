'use client';

import {
  getAccountClassification,
  PAYMENT_METHODS,
  type AccountDto,
  type CategoryDto,
  type CurrencyCode,
  type DraftNoteDto,
  type TransactionDraftDto,
  type TransactionListItemDto,
  type TransactionType,
} from '@calmcash/shared';
import { LoaderCircle, Scale } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import {
  ACCOUNT_TYPE_PRESENTATION,
  describeAdjustmentDirection,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_TYPE_PRESENTATION,
} from '@/lib/finance-presentation';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { createTransaction, updateTransaction } from '@/services/transactions.service';

import {
  buildCreateTransactionInput,
  buildUpdateTransactionInput,
  draftToFormValues,
  emptyTransactionFormValues,
  isTransactionType,
  splitTags,
  transactionErrorsFromPaths,
  transactionToFormValues,
  type TransactionFormField,
} from '../transaction-form-model';
import { CategorySelect } from './category-select';
import { CategorySuggestion } from './category-suggestion';
import { DescribeIt, type DraftResult } from './describe-it';
import { TagInput } from './tag-input';

/** Types recorded through this form; balance corrections use the reconciliation workflow. */
export type EntryType = Exclude<TransactionType, 'balance_adjustment'>;

/** A draft the assistant read from the person's own words: shown for review, never saved by itself. */
export interface DraftPrefill {
  draft: TransactionDraftDto;
  notes: readonly DraftNoteDto[];
  /** What the assistant still needs to know, when the words left something open. */
  question?: string | undefined;
}

export function prefillFromDraft(result: DraftResult): DraftPrefill {
  return {
    draft: result.draft,
    notes: result.notes,
    ...(result.kind === 'clarification' ? { question: result.question } : {}),
  };
}

export type TransactionFormMode =
  | {
      kind: 'create';
      type: EntryType;
      accountId?: string | undefined;
      prefill?: DraftPrefill | undefined;
    }
  | { kind: 'edit'; item: TransactionListItemDto };

export interface TransactionFormProps {
  mode: TransactionFormMode;
  /** All of the user's accounts; only active ones can be chosen. */
  accounts: readonly AccountDto[];
  categories: readonly CategoryDto[];
  tagSuggestions: readonly string[];
  timeZone: string;
  defaultCurrency: CurrencyCode;
  onSaved: (item: TransactionListItemDto) => void;
  onCancel: () => void;
  /** Switches to the reconciliation workflow (from the type picker). */
  onAdjustBalance: (accountId: string | undefined) => void;
}

const ENTRY_TYPES: readonly EntryType[] = ['expense', 'income', 'transfer'];

/** One idempotency key per form: a retry after a lost response can never record twice. */
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function TypePicker({
  value,
  allowAdjustment,
  onChange,
  onAdjust,
}: {
  value: string;
  allowAdjustment: boolean;
  onChange: (type: EntryType) => void;
  onAdjust: () => void;
}): ReactNode {
  const option = (type: TransactionType, checked: boolean, select: () => void): ReactNode => {
    const { label, description } = TRANSACTION_TYPE_PRESENTATION[type];
    return (
      <label key={type} className="relative min-w-0">
        <input
          type="radio"
          name="transaction-type"
          value={type}
          checked={checked}
          onChange={(event) => {
            if (event.target.checked) {
              select();
            }
          }}
          className="peer sr-only"
        />
        <span className="flex h-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-muted/60">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </span>
      </label>
    );
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Type</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ENTRY_TYPES.map((type) =>
          option(type, value === type, () => {
            onChange(type);
          }),
        )}
        {allowAdjustment && option('balance_adjustment', false, onAdjust)}
      </div>
    </fieldset>
  );
}

function AccountOptions({ accounts }: { accounts: readonly AccountDto[] }): ReactNode {
  return accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name} · {ACCOUNT_TYPE_PRESENTATION[account.type].label} · {account.currency}
    </option>
  ));
}

/**
 * Records or edits income, an expense, or a transfer, showing only the fields that type uses. The
 * merchant or payer comes right after the amount, because remembering where money went is what
 * CalmCash is for. Amounts are parsed exactly in the account's currency; the API checks
 * everything again.
 */
export function TransactionForm({
  mode,
  accounts,
  categories,
  tagSuggestions,
  timeZone,
  defaultCurrency,
  onSaved,
  onCancel,
  onAdjustBalance,
}: TransactionFormProps): ReactNode {
  const editing = mode.kind === 'edit' ? mode.item : undefined;
  const active = accounts.filter((account) => account.status === 'active');
  const onlyAccount = active.length === 1 ? active[0]?.id : undefined;
  const valuesFromDraft = (draft: TransactionDraftDto): ReturnType<typeof draftToFormValues> => {
    const values = draftToFormValues(draft, timeZone, new Date());
    return values.accountId === '' && onlyAccount !== undefined
      ? { ...values, accountId: onlyAccount }
      : values;
  };
  const [initial] = useState(() => {
    if (editing !== undefined) {
      return transactionToFormValues(editing.transaction, timeZone);
    }
    if (mode.kind === 'create' && mode.prefill !== undefined) {
      return valuesFromDraft(mode.prefill.draft);
    }
    const preset = mode.kind === 'create' ? mode.accountId : undefined;
    return emptyTransactionFormValues(
      mode.kind === 'create' ? mode.type : 'expense',
      timeZone,
      new Date(),
      preset ?? onlyAccount ?? '',
    );
  });
  const form = useFormFields(initial);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [prefill, setPrefill] = useState<DraftPrefill | undefined>(
    mode.kind === 'create' ? mode.prefill : undefined,
  );

  /** Replaces what was typed with a fresh draft (only while adding, never while editing). */
  const applyDraft = (result: DraftResult): void => {
    setFailure(undefined);
    form.reset(valuesFromDraft(result.draft));
    setPrefill(prefillFromDraft(result));
  };

  const type = isTransactionType(form.values.type) ? form.values.type : 'expense';
  const source = accounts.find((account) => account.id === form.values.accountId);
  const currency = source?.currency ?? defaultCurrency;
  const destinations = active.filter(
    (account) =>
      account.id !== form.values.accountId &&
      (source === undefined || account.currency === source.currency),
  );
  // Open when editing something that already has these details; never collapses while typing.
  const [moreOpen] = useState(
    () => initial.notes !== '' || initial.tags !== '' || initial.paymentMethod !== '',
  );

  const setValue = (field: TransactionFormField, value: string): void => {
    setFailure(undefined);
    form.setValue(field, value);
  };

  const changeType = (next: EntryType): void => {
    setValue('type', next);
    // Problems found for the previous type (e.g. a missing purpose) may not apply any more.
    form.setErrors({});
    const category = categories.find((entry) => entry.id === form.values.categoryId);
    if (category !== undefined && category.kind !== next) {
      setValue('categoryId', '');
    }
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setFailure(undefined);

    let save: () => Promise<TransactionListItemDto>;
    if (editing === undefined) {
      const built = buildCreateTransactionInput(form.values, accounts, timeZone);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      save = () => createTransaction(built.input, idempotencyKey);
    } else {
      const built = buildUpdateTransactionInput(
        editing.transaction,
        form.values,
        accounts,
        timeZone,
      );
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      const changes = built.input;
      if (changes === undefined) {
        onSaved(editing); // Nothing changed.
        return;
      }
      save = () => updateTransaction(editing.transaction.id, changes);
    }

    setSubmitting(true);
    try {
      onSaved(await save());
    } catch (error: unknown) {
      // Everything typed stays in place, so the person can fix it or simply try again.
      if (error instanceof ApiClientError && error.details !== undefined) {
        form.setErrors(transactionErrorsFromPaths(error.details));
      }
      setFailure(describeRequestError(error));
      setSubmitting(false);
    }
  };

  const adjustment = type === 'balance_adjustment';
  const classification = source === undefined ? 'asset' : getAccountClassification(source.type);

  return (
    <form
      noValidate
      aria-label={editing === undefined ? 'Add a transaction' : 'Edit transaction'}
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      {editing === undefined && !adjustment && <DescribeIt onDraft={applyDraft} />}
      {prefill !== undefined && (
        <FormMessage tone="info" title="Filled in from your words">
          {prefill.question !== undefined && <p className="font-medium">{prefill.question}</p>}
          <p>Check every field below. Nothing is recorded until you add it.</p>
          {prefill.notes.length > 0 && (
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-muted-foreground">
              {prefill.notes.map((note) => (
                <li key={`${note.field}:${note.message}`}>{note.message}</li>
              ))}
            </ul>
          )}
        </FormMessage>
      )}

      {adjustment ? (
        <FormMessage tone="info" title="Balance adjustment">
          A correction recorded to match the balance your bank or statement showed. It never counts
          as income or spending.
        </FormMessage>
      ) : (
        <TypePicker
          value={type}
          allowAdjustment={editing === undefined}
          onChange={changeType}
          onAdjust={() => {
            onAdjustBalance(form.values.accountId === '' ? undefined : form.values.accountId);
          }}
        />
      )}

      {type === 'transfer' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="transaction-from" label="From account" error={form.errors.accountId}>
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
                <AccountOptions accounts={active} />
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="transaction-to"
            label="To account"
            error={form.errors.transferAccountId}
            hint="Transfers stay within one currency."
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="transferAccountId"
                value={form.values.transferAccountId}
                onChange={(event) => {
                  setValue('transferAccountId', event.target.value);
                }}
              >
                <option value="">Choose an account</option>
                <AccountOptions accounts={destinations} />
              </NativeSelect>
            )}
          </FormField>
        </div>
      )}

      <FormField
        id="transaction-amount"
        label="Amount"
        error={form.errors.amount}
        hint={
          type === 'transfer' ? 'This is not income or spending, just money moving.' : undefined
        }
      >
        {(control) => (
          <MoneyInput
            {...control}
            name="amount"
            currency={currency}
            value={form.values.amount}
            onChange={(event) => {
              setValue('amount', event.target.value);
            }}
          />
        )}
      </FormField>

      {adjustment && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">Direction</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['increase', 'decrease'] as const).map((direction) => (
              <label key={direction} className="relative">
                <input
                  type="radio"
                  name="adjustment-direction"
                  value={direction}
                  checked={form.values.adjustmentDirection === direction}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setValue('adjustmentDirection', direction);
                    }
                  }}
                  className="peer sr-only"
                />
                <span className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium peer-checked:border-primary peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                  <Scale aria-hidden="true" className="size-4 text-muted-foreground" />
                  {describeAdjustmentDirection(direction, classification)}
                </span>
              </label>
            ))}
          </div>
          {form.errors.adjustmentDirection !== undefined && (
            <p className="text-sm text-expense">{form.errors.adjustmentDirection}</p>
          )}
        </fieldset>
      )}

      {(type === 'expense' || type === 'income') && (
        <>
          <FormField
            id="transaction-merchant"
            label={type === 'expense' ? 'Paid to' : 'Received from'}
            error={form.errors.merchant}
            hint={
              type === 'expense' ? 'The shop, person, or company.' : 'Employer, client, or person.'
            }
          >
            {(control) => (
              <Input
                {...control}
                name="merchant"
                autoComplete="off"
                placeholder={type === 'expense' ? 'e.g. FreshMart' : 'e.g. Acme Corp'}
                className="h-11"
                value={form.values.merchant}
                onChange={(event) => {
                  setValue('merchant', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            id="transaction-description"
            label="What was it for?"
            error={form.errors.description}
          >
            {(control) => (
              <Input
                {...control}
                name="description"
                autoComplete="off"
                placeholder={type === 'expense' ? 'e.g. Weekly groceries' : 'e.g. October salary'}
                className="h-11"
                value={form.values.description}
                onChange={(event) => {
                  setValue('description', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField id="transaction-category" label="Category" error={form.errors.categoryId}>
            {(control) => (
              <CategorySelect
                {...control}
                name="categoryId"
                categories={categories}
                kind={type}
                placeholder="Choose a category"
                keepId={editing?.category?.id}
                value={form.values.categoryId}
                onChange={(event) => {
                  setValue('categoryId', event.target.value);
                }}
              />
            )}
          </FormField>
          <CategorySuggestion
            type={type}
            description={form.values.description}
            merchant={form.values.merchant}
            categories={categories}
            onUse={(categoryId) => {
              setValue('categoryId', categoryId);
            }}
          />
        </>
      )}

      {type !== 'transfer' && (
        <FormField
          id="transaction-account"
          label={type === 'income' ? 'Received into' : type === 'expense' ? 'Paid from' : 'Account'}
          error={form.errors.accountId}
        >
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
              <AccountOptions accounts={active} />
            </NativeSelect>
          )}
        </FormField>
      )}

      {(type === 'transfer' || adjustment) && (
        <FormField
          id="transaction-description"
          label={adjustment ? 'Reason' : 'Purpose (optional)'}
          error={form.errors.description}
        >
          {(control) => (
            <Input
              {...control}
              name="description"
              autoComplete="off"
              placeholder={adjustment ? 'e.g. Matched to bank statement' : 'e.g. Credit card bill'}
              className="h-11"
              value={form.values.description}
              onChange={(event) => {
                setValue('description', event.target.value);
              }}
            />
          )}
        </FormField>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-3">
        <FormField id="transaction-date" label="Date" error={form.errors.date}>
          {(control) => (
            <Input
              {...control}
              name="date"
              type="date"
              min="1900-01-01"
              className="h-11"
              value={form.values.date}
              onChange={(event) => {
                setValue('date', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="transaction-time" label="Time" error={form.errors.time}>
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

      <details open={moreOpen} className="group rounded-xl border bg-card/60 px-4 py-3">
        <summary className="cursor-pointer rounded-sm text-sm font-medium outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          More details
          <span className="ml-1 font-normal text-muted-foreground">
            {adjustment ? '(tags, notes)' : '(payment method, tags, notes)'}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-5">
          {!adjustment && (
            <FormField
              id="transaction-method"
              label="Payment method"
              error={form.errors.paymentMethod}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  name="paymentMethod"
                  value={form.values.paymentMethod}
                  onChange={(event) => {
                    setValue('paymentMethod', event.target.value);
                  }}
                >
                  <option value="">Not specified</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
          <FormField
            id="transaction-tags"
            label="Tags"
            error={form.errors.tags}
            hint="Press Enter after each tag."
          >
            {(control) => (
              <TagInput
                control={control}
                tags={splitTags(form.values.tags)}
                suggestions={tagSuggestions}
                onChange={(tags) => {
                  setValue('tags', tags.join(','));
                }}
              />
            )}
          </FormField>
          <FormField id="transaction-notes" label="Notes" error={form.errors.notes}>
            {(control) => (
              <Textarea
                {...control}
                name="notes"
                rows={3}
                value={form.values.notes}
                onChange={(event) => {
                  setValue('notes', event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </details>

      {failure !== undefined && (
        <FormMessage tone="error" title="The transaction was not saved">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          className={cn('h-11 sm:h-9')}
          disabled={submitting}
          aria-disabled={submitting}
        >
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {submitting
            ? 'Saving…'
            : editing === undefined
              ? `Add ${TRANSACTION_TYPE_PRESENTATION[type].label.toLowerCase()}`
              : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
