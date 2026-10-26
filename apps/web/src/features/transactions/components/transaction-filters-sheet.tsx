'use client';

import {
  AMOUNT_FILTER_PATTERN,
  calendarDateInTimeZone,
  compareAmountFilters,
  PAYMENT_METHODS,
  TRANSACTION_TYPES,
  type AccountDto,
  type CategoryDto,
  type TransactionStatusFilter,
} from '@calmcash/shared';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FilterOptions } from '@/components/forms/filter-bar';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_PRESENTATION } from '@/lib/finance-presentation';

import { isTransactionType } from '../transaction-form-model';
import {
  DEFAULT_FILTERS,
  PERIOD_PRESETS,
  periodRange,
  type TransactionFilters,
} from '../transaction-filters';
import { CategorySelect } from './category-select';
import { TagInput } from './tag-input';

export interface TransactionFiltersSheetProps {
  open: boolean;
  filters: TransactionFilters;
  accounts: readonly AccountDto[];
  categories: readonly CategoryDto[];
  tagSuggestions: readonly string[];
  timeZone: string;
  onApply: (filters: TransactionFilters) => void;
  onClose: () => void;
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  ...TRANSACTION_TYPES.map((type) => ({
    value: type,
    label:
      type === 'balance_adjustment' ? 'Adjustments' : TRANSACTION_TYPE_PRESENTATION[type].label,
  })),
] as const;

const STATUS_OPTIONS: readonly { value: TransactionStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'voided', label: 'Voided' },
  { value: 'all', label: 'Both' },
];

/** Removes digit grouping people type ("1,500") before the strict amount check. */
function normalizeAmount(value: string): string {
  return value.trim().replace(/[,\s]/g, '');
}

function Editor({
  filters,
  accounts,
  categories,
  tagSuggestions,
  timeZone,
  onApply,
  onClose,
}: Omit<TransactionFiltersSheetProps, 'open'>): ReactNode {
  const [draft, setDraft] = useState(filters);
  const [minAmount, setMinAmount] = useState(filters.minAmount ?? '');
  const [maxAmount, setMaxAmount] = useState(filters.maxAmount ?? '');
  const [errors, setErrors] = useState<{ amount?: string; to?: string }>({});
  const today = calendarDateInTimeZone(new Date(), timeZone);

  const update = (changes: Partial<TransactionFilters>): void => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const apply = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const min = normalizeAmount(minAmount);
    const max = normalizeAmount(maxAmount);
    const problems: { amount?: string; to?: string } = {};
    if (
      (min !== '' && !AMOUNT_FILTER_PATTERN.test(min)) ||
      (max !== '' && !AMOUNT_FILTER_PATTERN.test(max))
    ) {
      problems.amount = 'Enter amounts such as 500 or 99.99.';
    } else if (min !== '' && max !== '' && compareAmountFilters(min, max) > 0) {
      problems.amount = 'The maximum must be at least the minimum.';
    }
    if (draft.from !== undefined && draft.to !== undefined && draft.from > draft.to) {
      problems.to = 'The end date must be on or after the start date.';
    }
    setErrors(problems);
    if (problems.amount !== undefined || problems.to !== undefined) {
      return;
    }
    onApply({
      ...draft,
      minAmount: min === '' ? undefined : min,
      maxAmount: max === '' ? undefined : max,
      page: 1,
    });
  };

  return (
    <form
      noValidate
      aria-label="Filter transactions"
      onSubmit={apply}
      className="flex flex-col gap-6"
    >
      <FilterOptions
        legend="Type"
        name="filter-type"
        options={TYPE_OPTIONS}
        value={draft.type ?? 'all'}
        onValueChange={(value) => {
          update({ type: isTransactionType(value) ? value : undefined });
        }}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1.5 text-sm font-medium">Dates</legend>
        <div className="flex flex-wrap gap-2">
          {PERIOD_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              type="button"
              variant="outline"
              className="h-9 rounded-full"
              onClick={() => {
                update(periodRange(preset.value, today));
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="filter-from" label="From">
            {(control) => (
              <Input
                {...control}
                type="date"
                className="h-11"
                value={draft.from ?? ''}
                onChange={(event) => {
                  update({ from: event.target.value === '' ? undefined : event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField id="filter-to" label="To" error={errors.to}>
            {(control) => (
              <Input
                {...control}
                type="date"
                className="h-11"
                value={draft.to ?? ''}
                onChange={(event) => {
                  update({ to: event.target.value === '' ? undefined : event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground">
          Dates are days in your time zone ({timeZone}).
        </p>
      </fieldset>

      <FormField id="filter-account" label="Account">
        {(control) => (
          <NativeSelect
            {...control}
            value={draft.accountId ?? ''}
            onChange={(event) => {
              update({ accountId: event.target.value === '' ? undefined : event.target.value });
            }}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.status === 'archived' ? ' (archived)' : ''}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <FormField
        id="filter-category"
        label="Category"
        hint="Choosing a category includes its subcategories."
      >
        {(control) => (
          <CategorySelect
            {...control}
            categories={categories}
            placeholder="All categories"
            keepId={draft.categoryId}
            value={draft.categoryId ?? ''}
            onChange={(event) => {
              update({ categoryId: event.target.value === '' ? undefined : event.target.value });
            }}
          />
        )}
      </FormField>

      <FormField id="filter-method" label="Payment method">
        {(control) => (
          <NativeSelect
            {...control}
            value={draft.paymentMethod ?? ''}
            onChange={(event) => {
              const method = PAYMENT_METHODS.find((entry) => entry === event.target.value);
              update({ paymentMethod: method });
            }}
          >
            <option value="">Any method</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <FormField id="filter-tags" label="Tags" hint="Shows transactions with all of these tags.">
        {(control) => (
          <TagInput
            control={control}
            tags={draft.tags}
            suggestions={tagSuggestions}
            onChange={(tags) => {
              update({ tags });
            }}
          />
        )}
      </FormField>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Amount</legend>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="filter-min" label="At least">
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className="h-11 tabular-nums"
                value={minAmount}
                onChange={(event) => {
                  setMinAmount(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField id="filter-max" label="At most">
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Any"
                className="h-11 tabular-nums"
                value={maxAmount}
                onChange={(event) => {
                  setMaxAmount(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        {errors.amount !== undefined ? (
          <p role="alert" className="text-sm text-expense">
            {errors.amount}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            In each transaction’s own currency, without conversion.
          </p>
        )}
      </fieldset>

      <FilterOptions
        legend="Show"
        name="filter-status"
        options={STATUS_OPTIONS}
        value={draft.status}
        onValueChange={(status) => {
          update({ status });
        }}
      />

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          className="h-11 sm:h-9"
          onClick={() => {
            onApply({ ...DEFAULT_FILTERS, q: filters.q, sort: filters.sort });
          }}
        >
          Clear filters
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 sm:h-9">
            Show results
          </Button>
        </div>
      </div>
    </form>
  );
}

/** All filters in one sheet: a bottom-friendly side sheet that fits phones as well as desktops. */
export function TransactionFiltersSheet({
  open,
  ...props
}: TransactionFiltersSheetProps): ReactNode {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          props.onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
          <SheetTitle className="text-lg">Filters</SheetTitle>
          <SheetDescription>
            Combine as many as you like; the totals follow the list.
          </SheetDescription>
        </SheetHeader>
        <div className="px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          {open && <Editor {...props} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
