'use client';

import {
  BUDGET_PERIODS,
  CURRENCIES,
  CURRENCY_CODES,
  type BudgetWithProgressDto,
  type CategoryDto,
  type CurrencyCode,
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
import { describeRequestError } from '@/lib/form-errors';
import { createBudget, updateBudget } from '@/services/budgets.service';

import {
  budgetErrorsFromPaths,
  budgetToFormValues,
  buildCreateBudgetInput,
  buildUpdateBudgetInput,
  emptyBudgetFormValues,
  type BudgetFormField,
  type BudgetFormValues,
} from '../budget-form-model';
import { PERIOD_OPTION_LABELS } from '../budget-presentation';

export type BudgetFormMode = { kind: 'create' } | { kind: 'edit'; item: BudgetWithProgressDto };

export interface BudgetFormProps {
  mode: BudgetFormMode;
  categories: readonly CategoryDto[];
  defaultCurrency: CurrencyCode;
  timeZone: string;
  onSaved: (item: BudgetWithProgressDto) => void;
  onCancel: () => void;
  /**
   * Values to start from instead of the defaults or the saved budget (e.g. a suggested limit from
   * Insights). Nothing is saved until the person submits the form.
   */
  initialValues?: Partial<BudgetFormValues> | undefined;
}

const SCOPES = [
  { value: 'category', label: 'One category', description: 'e.g. Food, Transport' },
  { value: 'overall', label: 'All spending', description: 'Every expense in the currency' },
] as const;

/**
 * Creates or edits a budget. A monthly category budget needs only a name, a category, and a
 * limit; the period, dates, and alerts have sensible defaults and stay out of the way.
 */
export function BudgetForm({
  mode,
  categories,
  defaultCurrency,
  timeZone,
  onSaved,
  onCancel,
  initialValues,
}: BudgetFormProps): ReactNode {
  const editing = mode.kind === 'edit' ? mode.item : undefined;
  const form = useFormFields({
    ...(editing === undefined
      ? emptyBudgetFormValues(defaultCurrency, timeZone)
      : budgetToFormValues(editing.budget)),
    ...initialValues,
  });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [showMore, setShowMore] = useState(editing !== undefined);
  const currency = CURRENCY_CODES.find((code) => code === form.values.currency) ?? defaultCurrency;
  const custom = form.values.period === 'custom';

  const setValue = (field: BudgetFormField, value: string): void => {
    setFailure(undefined);
    form.setValue(field, value);
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setFailure(undefined);
    let save: () => Promise<BudgetWithProgressDto>;
    if (editing === undefined) {
      const built = buildCreateBudgetInput(form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        if (built.errors.endDate !== undefined || built.errors.alerts !== undefined) {
          setShowMore(true);
        }
        return;
      }
      save = () => createBudget(built.input);
    } else {
      const built = buildUpdateBudgetInput(editing.budget, form.values);
      if (!built.ok) {
        form.setErrors(built.errors);
        return;
      }
      const changes = built.input;
      if (changes === undefined) {
        onSaved(editing);
        return;
      }
      save = () => updateBudget(editing.budget.id, changes);
    }
    setSubmitting(true);
    try {
      onSaved(await save());
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.details !== undefined) {
        form.setErrors(budgetErrorsFromPaths(error.details));
      }
      setFailure(describeRequestError(error));
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={editing === undefined ? 'Create a budget' : 'Edit budget'}
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-5"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">What does it cover?</legend>
        <div className="grid grid-cols-2 gap-2">
          {SCOPES.map((scope) => (
            <label key={scope.value} className="relative min-w-0">
              <input
                type="radio"
                name="budget-scope"
                value={scope.value}
                checked={form.values.scope === scope.value}
                onChange={(event) => {
                  if (event.target.checked) setValue('scope', scope.value);
                }}
                className="peer sr-only"
              />
              <span className="flex h-full cursor-pointer flex-col gap-1 rounded-xl border bg-card p-3 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-muted/60">
                <span className="text-sm font-medium">{scope.label}</span>
                <span className="text-xs text-muted-foreground">{scope.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {form.values.scope === 'category' && (
        <FormField
          id="budget-category"
          label="Category"
          error={form.errors.categoryId}
          hint="A category budget includes its subcategories."
        >
          {(control) => (
            <CategorySelect
              {...control}
              categories={categories}
              kind="expense"
              placeholder="Choose a category"
              keepId={editing?.budget.categoryId}
              value={form.values.categoryId}
              onChange={(event) => {
                setValue('categoryId', event.target.value);
                const chosen = categories.find((entry) => entry.id === event.target.value);
                if (form.values.name.trim() === '' && chosen !== undefined) {
                  setValue('name', chosen.name);
                }
              }}
            />
          )}
        </FormField>
      )}

      <FormField id="budget-name" label="Name" error={form.errors.name}>
        {(control) => (
          <Input
            {...control}
            name="name"
            autoComplete="off"
            placeholder={form.values.scope === 'overall' ? 'e.g. Monthly spending' : 'e.g. Food'}
            className="h-11"
            value={form.values.name}
            onChange={(event) => {
              setValue('name', event.target.value);
            }}
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
        <FormField id="budget-limit" label="Limit" error={form.errors.limit}>
          {(control) => (
            <MoneyInput
              {...control}
              name="limit"
              currency={currency}
              value={form.values.limit}
              onChange={(event) => {
                setValue('limit', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="budget-period" label="Every" error={form.errors.period}>
          {(control) => (
            <NativeSelect
              {...control}
              name="period"
              value={form.values.period}
              onChange={(event) => {
                setValue('period', event.target.value);
                if (event.target.value === 'custom') setShowMore(true);
              }}
            >
              {BUDGET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {PERIOD_OPTION_LABELS[period]}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      {!showMore ? (
        <Button
          type="button"
          variant="link"
          className="h-auto self-start px-0"
          onClick={() => {
            setShowMore(true);
          }}
        >
          Dates, currency, and alerts
        </Button>
      ) : (
        <div className="flex flex-col gap-5 rounded-xl border bg-muted/20 p-4">
          <FormField id="budget-currency" label="Currency" error={form.errors.currency}>
            {(control) => (
              <NativeSelect
                {...control}
                name="currency"
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
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="budget-start"
              label={custom ? 'From' : 'Starts'}
              error={form.errors.startDate}
              hint={custom ? undefined : 'Spending before this day is not counted.'}
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
            <FormField
              id="budget-end"
              label={custom ? 'To' : 'Ends (optional)'}
              error={form.errors.endDate}
              hint={custom ? undefined : 'Leave empty to repeat every period.'}
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
          </div>
          <FormField
            id="budget-alerts"
            label="Alert me at (% of the limit)"
            error={form.errors.alerts}
            hint="Up to three, e.g. 50, 80. Leave empty for none. Reaching the limit is always shown."
          >
            {(control) => (
              <Input
                {...control}
                name="alerts"
                inputMode="decimal"
                autoComplete="off"
                className="h-11"
                value={form.values.alerts}
                onChange={(event) => {
                  setValue('alerts', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            id="budget-description"
            label="Note (optional)"
            error={form.errors.description}
          >
            {(control) => (
              <Input
                {...control}
                name="description"
                autoComplete="off"
                className="h-11"
                value={form.values.description}
                onChange={(event) => {
                  setValue('description', event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      )}

      {failure !== undefined && (
        <FormMessage tone="error" title="The budget was not saved">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-10" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {editing === undefined ? 'Create budget' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
