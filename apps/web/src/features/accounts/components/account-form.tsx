'use client';

import {
  ACCOUNT_COLORS,
  calendarDateInTimeZone,
  CREATABLE_ACCOUNT_TYPES,
  CURRENCIES,
  CURRENCY_CODES,
  type AccountWithBalanceDto,
  type CreatableAccountType,
  type CurrencyCode,
} from '@calmcash/shared';
import { Check, LoaderCircle, Lock } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useFormFields } from '@/hooks/use-form-fields';
import { ApiClientError } from '@/lib/api-client';
import { ACCOUNT_COLOR_PRESENTATION, ACCOUNT_TYPE_PRESENTATION } from '@/lib/finance-presentation';
import { describeRequestError } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { createAccount, updateAccount } from '@/services/accounts.service';

import {
  accountToFormValues,
  buildCreateAccountInput,
  buildUpdateAccountInput,
  editableAccountTypes,
  emptyAccountFormValues,
  formErrorsFromPaths,
  getAccountTypeFormCopy,
  isCreatableAccountType,
} from '../account-form-model';

export type AccountFormMode = { kind: 'create' } | { kind: 'edit'; entry: AccountWithBalanceDto };

export interface AccountFormProps {
  mode: AccountFormMode;
  /** The user's preferred currency, preselected for new accounts. */
  defaultCurrency: CurrencyCode;
  /** The user's time zone, for "today". */
  timeZone: string;
  onSaved: (entry: AccountWithBalanceDto) => void;
  onCancel: () => void;
}

function TypePicker({
  types,
  value,
  error,
  onChange,
}: {
  types: readonly CreatableAccountType[];
  value: string;
  error: string | undefined;
  onChange: (type: CreatableAccountType) => void;
}): ReactNode {
  return (
    <fieldset
      aria-describedby={error === undefined ? undefined : 'account-type-error'}
      className="flex flex-col gap-2"
    >
      <legend className="mb-1.5 text-sm font-medium">Account type</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((type) => {
          const { icon: Icon, label, description } = ACCOUNT_TYPE_PRESENTATION[type];
          return (
            <label key={type} className="relative min-w-0">
              <input
                type="radio"
                name="account-type"
                value={type}
                checked={value === type}
                onChange={(event) => {
                  if (event.target.checked && isCreatableAccountType(event.target.value)) {
                    onChange(event.target.value);
                  }
                }}
                className="peer sr-only"
              />
              <span className="flex h-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-3 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-muted/60">
                <Icon aria-hidden="true" className="size-5 text-foreground" />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error !== undefined && (
        <p id="account-type-error" className="text-sm text-expense">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}): ReactNode {
  const options = [
    { value: '', label: 'Default', swatchClassName: 'bg-card ring-1 ring-border ring-inset' },
    ...ACCOUNT_COLORS.map((color) => ({
      value: color,
      label: ACCOUNT_COLOR_PRESENTATION[color].label,
      swatchClassName: ACCOUNT_COLOR_PRESENTATION[color].swatchClassName,
    })),
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Colour (optional)</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value === '' ? 'default' : option.value} className="relative">
            <input
              type="radio"
              name="account-color"
              value={option.value}
              checked={value === option.value}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange(event.target.value);
                }
              }}
              className="peer sr-only"
            />
            <span className="sr-only">{option.label}</span>
            <span
              aria-hidden="true"
              className={cn(
                'grid size-10 cursor-pointer place-items-center rounded-full peer-checked:ring-2 peer-checked:ring-ring peer-checked:ring-offset-2 peer-checked:ring-offset-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring',
                option.swatchClassName,
              )}
            >
              {value === option.value && (
                <Check
                  className={cn(
                    'size-4',
                    option.value === '' ? 'text-foreground' : 'text-background',
                  )}
                />
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Creates or edits an account. The type comes first and decides which fields appear and how the
 * balance is described (a card asks for the amount owed). Amounts are parsed exactly in the
 * currency's precision; the API applies the same rules again.
 */
export function AccountForm({
  mode,
  defaultCurrency,
  timeZone,
  onSaved,
  onCancel,
}: AccountFormProps): ReactNode {
  const editing = mode.kind === 'edit' ? mode.entry : undefined;
  const form = useFormFields(
    editing === undefined
      ? emptyAccountFormValues(defaultCurrency, timeZone)
      : accountToFormValues(editing.account),
  );
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const type = isCreatableAccountType(form.values.type) ? form.values.type : undefined;
  const copy = type === undefined ? undefined : getAccountTypeFormCopy(type);
  const locked = editing?.hasTransactions === true;
  const types =
    editing === undefined ? CREATABLE_ACCOUNT_TYPES : editableAccountTypes(editing.account.type);
  const currency = CURRENCY_CODES.find((code) => code === form.values.currency) ?? defaultCurrency;
  const today = calendarDateInTimeZone(new Date(), timeZone);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setFailure(undefined);

    // Each branch validates first, so nothing is sent until the form is valid.
    let save: () => Promise<AccountWithBalanceDto>;
    if (editing === undefined) {
      const built = buildCreateAccountInput(form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      save = () => createAccount(built.input);
    } else {
      const built = buildUpdateAccountInput(editing.account, form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      const changes = built.input;
      if (changes === undefined) {
        onSaved(editing); // Nothing changed.
        return;
      }
      save = () => updateAccount(editing.account.id, changes);
    }

    setSubmitting(true);
    try {
      onSaved(await save());
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.details !== undefined) {
        form.setErrors(formErrorsFromPaths(error.details));
      }
      setFailure(describeRequestError(error));
      setSubmitting(false);
    }
  };

  const setValue = (field: Parameters<typeof form.setValue>[0], value: string): void => {
    setFailure(undefined);
    form.setValue(field, value);
  };

  return (
    <form
      noValidate
      aria-label={editing === undefined ? 'Add an account' : 'Edit account'}
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      <TypePicker
        types={types}
        value={form.values.type}
        error={form.errors.type}
        onChange={(next) => {
          setValue('type', next);
        }}
      />

      {copy !== undefined && (
        <>
          <FormField id="account-name" label="Account name" error={form.errors.name}>
            {(control) => (
              <Input
                {...control}
                name="name"
                autoComplete="off"
                placeholder={type === 'cash' ? 'e.g. Wallet cash' : 'e.g. HDFC Salary'}
                className="h-11"
                value={form.values.name}
                onChange={(event) => {
                  setValue('name', event.target.value);
                }}
              />
            )}
          </FormField>

          {copy.institutionLabel !== undefined && (
            <FormField
              id="account-institution"
              label={copy.institutionLabel}
              error={form.errors.institution}
              hint="Only the name. Never enter account or card numbers."
            >
              {(control) => (
                <Input
                  {...control}
                  name="institution"
                  autoComplete="off"
                  className="h-11"
                  value={form.values.institution}
                  onChange={(event) => {
                    setValue('institution', event.target.value);
                  }}
                />
              )}
            </FormField>
          )}

          {locked && (
            <FormMessage tone="info" title="Opening balance locked">
              This account already has transactions, so its currency, opening balance, and opening
              date stay as they are. Other details can still change.
            </FormMessage>
          )}

          <FormField id="account-currency" label="Currency" error={form.errors.currency}>
            {(control) => (
              <NativeSelect
                {...control}
                name="currency"
                disabled={locked}
                value={form.values.currency}
                onChange={(event) => {
                  setValue('currency', event.target.value);
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

          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
            <FormField
              id="account-opening-balance"
              label={copy.balanceLabel}
              error={form.errors.openingBalance}
              hint={copy.balanceHint}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  name="openingBalance"
                  currency={currency}
                  disabled={locked}
                  value={form.values.openingBalance}
                  onChange={(event) => {
                    setValue('openingBalance', event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField
              id="account-opening-date"
              label="Balance as of"
              error={form.errors.openingBalanceDate}
              hint="Transactions from this day on will update the balance."
            >
              {(control) => (
                <Input
                  {...control}
                  name="openingBalanceDate"
                  type="date"
                  max={today}
                  min="1900-01-01"
                  disabled={locked}
                  className="h-11"
                  value={form.values.openingBalanceDate}
                  onChange={(event) => {
                    setValue('openingBalanceDate', event.target.value);
                  }}
                />
              )}
            </FormField>
          </div>

          {copy.showCreditLimit && (
            <FormField
              id="account-credit-limit"
              label="Credit limit (optional)"
              error={form.errors.creditLimit}
              hint="Used to show how much credit is still available."
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  name="creditLimit"
                  currency={currency}
                  value={form.values.creditLimit}
                  onChange={(event) => {
                    setValue('creditLimit', event.target.value);
                  }}
                />
              )}
            </FormField>
          )}

          <ColorPicker
            value={form.values.color}
            onChange={(color) => {
              setValue('color', color);
            }}
          />
        </>
      )}

      {failure !== undefined && (
        <FormMessage tone="error" title="The account was not saved">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 sm:h-9"
          disabled={submitting || type === undefined}
          aria-disabled={submitting || type === undefined}
        >
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {submitting ? 'Saving…' : editing === undefined ? 'Add account' : 'Save changes'}
        </Button>
      </div>
      {editing !== undefined && locked && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5" />
          To match your bank or statement, use Correct balance in the account’s details.
        </p>
      )}
    </form>
  );
}
