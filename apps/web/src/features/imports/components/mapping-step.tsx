'use client';

import {
  IMPORT_DATE_FORMATS,
  type CsvDelimiter,
  type ImportBatchDetailDto,
} from '@calmcash/shared';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiClientError } from '@/lib/api-client';
import { describeRequestProblems } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { saveImportSettings } from '@/services/imports.service';

import {
  balancesAreOwed,
  buildSettingsInput,
  DATE_FORMAT_EXAMPLES,
  initialMappingValues,
  type MappingField,
  type MappingFormErrors,
  type MappingFormValues,
} from '../import-settings-model';

const DELIMITER_NAMES: Readonly<Record<CsvDelimiter, string>> = {
  ',': 'commas',
  ';': 'semicolons',
  '\t': 'tabs',
  '|': 'vertical bars',
};

/** API detail paths (after `body.`) → the form field they concern. */
const API_FIELDS: Readonly<Record<string, MappingField>> = {
  'settings.mapping.date': 'date',
  'settings.mapping.description': 'description',
  'settings.mapping.counterparty': 'counterparty',
  'settings.mapping.reference': 'reference',
  'settings.mapping.amount': 'amount',
  'settings.dateFormat': 'dateFormat',
  'statement.periodStart': 'periodStart',
  'statement.periodEnd': 'periodEnd',
  'statement.openingBalanceMinor': 'openingBalance',
  'statement.closingBalanceMinor': 'closingBalance',
};

function apiFieldErrors(error: unknown): MappingFormErrors {
  const errors: MappingFormErrors = {};
  if (error instanceof ApiClientError) {
    for (const detail of error.details ?? []) {
      const field = API_FIELDS[detail.path.replace(/^body\./, '')];
      if (field !== undefined && errors[field] === undefined) {
        errors[field] = detail.message;
      }
    }
  }
  return errors;
}

export interface MappingStepProps {
  batch: ImportBatchDetailDto;
  onSaved: () => void;
}

/**
 * Which column holds what, how dates and amounts are written, and (optionally) the statement's
 * own period and balances. Proposed from the file, confirmed by the person: a date layout or sign
 * convention is never assumed.
 */
export function MappingStep({ batch, onSaved }: MappingStepProps): ReactNode {
  const [values, setValues] = useState<MappingFormValues>(() => initialMappingValues(batch));
  const [errors, setErrors] = useState<MappingFormErrors>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const owed = balancesAreOwed(batch.account.type);
  const locked = batch.counts.imported > 0 || batch.counts.matched > 0;

  const set = <TKey extends keyof MappingFormValues>(
    key: TKey,
    value: MappingFormValues[TKey],
  ): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    const built = buildSettingsInput(values, {
      columnCount: batch.columns.length,
      currency: batch.currency,
      accountType: batch.account.type,
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setSaving(true);
    try {
      await saveImportSettings(batch.id, built.input);
      onSaved();
    } catch (error: unknown) {
      setErrors(apiFieldErrors(error));
      setFailure(describeRequestProblems(error));
      setSaving(false);
    }
  };

  const columnSelect = (
    field: 'date' | 'description' | 'counterparty' | 'reference' | 'amount' | 'debit' | 'credit',
    label: string,
    placeholder: string,
    hint?: string,
  ): ReactNode => (
    <FormField id={`map-${field}`} label={label} error={errors[field]} hint={hint}>
      {(control) => (
        <NativeSelect
          {...control}
          value={values[field]}
          disabled={locked}
          onChange={(event) => {
            set(field, event.target.value);
          }}
        >
          <option value="">{placeholder}</option>
          {batch.columns.map((name, index) => (
            <option key={index} value={String(index)}>
              {name}
            </option>
          ))}
        </NativeSelect>
      )}
    </FormField>
  );

  const ambiguous = batch.proposed.dateFormats.length > 1;

  return (
    <form
      noValidate
      aria-label="Map the statement's columns"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-6"
    >
      <section aria-labelledby="sample-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="sample-heading"
          title="The file as it was read"
          description={`Values separated by ${DELIMITER_NAMES[batch.delimiter]}; ${
            batch.hasHeaderRow
              ? 'the first row has column names'
              : 'there is no row of column names'
          }. To read it another way, upload it again with a different file layout.`}
        />
        <SampleTable batch={batch} />
      </section>

      {locked && (
        <FormMessage tone="info">
          Rows of this statement are already imported or matched, so its columns stay as they are.
          You can still change the statement dates and balances.
        </FormMessage>
      )}

      <section
        aria-labelledby="columns-heading"
        className="flex flex-col gap-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <SectionHeader
          id="columns-heading"
          title="Columns"
          description="Proposed from the column names and the first rows. Check each one."
        />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {columnSelect('date', 'Date', 'Choose a column')}
          <FormField
            id="map-dateFormat"
            label="Dates are written as"
            error={errors.dateFormat}
            hint={
              ambiguous
                ? `These dates fit more than one layout (${batch.proposed.dateFormats.join(' or ')}). Choose the one your bank uses: a wrong choice swaps days and months.`
                : batch.proposed.dateFormats.length === 0
                  ? 'No layout fits every date in the first rows. Choose the closest; rows that do not fit are listed for you to check.'
                  : undefined
            }
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={values.dateFormat}
                disabled={locked}
                onChange={(event) => {
                  const format = IMPORT_DATE_FORMATS.find((entry) => entry === event.target.value);
                  set('dateFormat', format ?? '');
                }}
              >
                <option value="">Choose a date layout</option>
                {IMPORT_DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format} — e.g. {DATE_FORMAT_EXAMPLES[format]}
                    {batch.proposed.dateFormats.includes(format) ? ' (fits this file)' : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {columnSelect('description', 'Description', 'Choose a column')}
          {columnSelect('counterparty', 'Payee or payer (optional)', 'Not in this statement')}
          {columnSelect(
            'reference',
            'Reference (optional)',
            'Not in this statement',
            'A transaction ID, UTR, or cheque number. It helps spot duplicates.',
          )}
        </div>

        <fieldset className="flex flex-col gap-2" disabled={locked}>
          <legend className="mb-1.5 text-sm font-medium">How amounts are written</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Choice
              name="amount-mode"
              checked={values.amountMode === 'signed'}
              onSelect={() => {
                set('amountMode', 'signed');
              }}
              label="One amount column"
              description="Money in and out in one column, told apart by a minus sign."
            />
            <Choice
              name="amount-mode"
              checked={values.amountMode === 'split'}
              onSelect={() => {
                set('amountMode', 'split');
              }}
              label="Separate columns"
              description="One column for money out (debits), another for money in (credits)."
            />
          </div>
        </fieldset>

        {values.amountMode === 'signed' ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {columnSelect('amount', 'Amount', 'Choose a column')}
            <fieldset className="flex flex-col gap-2" disabled={locked}>
              <legend className="mb-1.5 text-sm font-medium">A negative amount is</legend>
              <div className="grid grid-cols-1 gap-2">
                <Choice
                  name="sign-convention"
                  checked={values.convention === 'negative_is_debit'}
                  onSelect={() => {
                    set('convention', 'negative_is_debit');
                  }}
                  label="Money out (a payment)"
                  description="Most bank accounts: −500 is a purchase."
                />
                <Choice
                  name="sign-convention"
                  checked={values.convention === 'negative_is_credit'}
                  onSelect={() => {
                    set('convention', 'negative_is_credit');
                  }}
                  label="Money in (a refund or payment received)"
                  description="Some card statements: −500 is a repayment."
                />
              </div>
              {errors.convention !== undefined && (
                <p className="text-sm text-expense">{errors.convention}</p>
              )}
            </fieldset>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {columnSelect('debit', 'Money out (debit)', 'Choose a column')}
            {columnSelect('credit', 'Money in (credit)', 'Choose a column')}
          </div>
        )}
        {errors.amount !== undefined && values.amountMode === 'split' && (
          <p className="text-sm text-expense">{errors.amount}</p>
        )}

        <FormField
          id="map-decimal"
          label="Decimal separator"
          className="md:max-w-[calc(50%-0.625rem)]"
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={values.decimalSeparator}
              disabled={locked}
              onChange={(event) => {
                set('decimalSeparator', event.target.value === ',' ? ',' : '.');
              }}
            >
              <option value=".">Point: 1,234.56</option>
              <option value=",">Comma: 1.234,56</option>
            </NativeSelect>
          )}
        </FormField>
      </section>

      <section
        aria-labelledby="statement-heading"
        className="flex flex-col gap-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <SectionHeader
          id="statement-heading"
          title="Statement period and balances (optional)"
          description="Copy them from the statement to compare it with your ledger at the end. CalmCash never invents them."
        />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FormField id="map-periodStart" label="First day" error={errors.periodStart}>
            {(control) => (
              <Input
                {...control}
                type="date"
                className="h-11"
                value={values.periodStart}
                onChange={(event) => {
                  set('periodStart', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField id="map-periodEnd" label="Last day" error={errors.periodEnd}>
            {(control) => (
              <Input
                {...control}
                type="date"
                className="h-11"
                value={values.periodEnd}
                onChange={(event) => {
                  set('periodEnd', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            id="map-openingBalance"
            label={owed ? 'Amount owed at the start' : 'Opening balance'}
            error={errors.openingBalance}
            hint={
              owed ? 'Use a minus sign for a credit balance.' : 'Use a minus sign for an overdraft.'
            }
          >
            {(control) => (
              <MoneyInput
                {...control}
                currency={batch.currency}
                value={values.openingBalance}
                onChange={(event) => {
                  set('openingBalance', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            id="map-closingBalance"
            label={owed ? 'Amount owed at the end' : 'Closing balance'}
            error={errors.closingBalance}
          >
            {(control) => (
              <MoneyInput
                {...control}
                currency={batch.currency}
                value={values.closingBalance}
                onChange={(event) => {
                  set('closingBalance', event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </section>

      {failure !== undefined && (
        <FormMessage tone="error" title="The settings were not saved">
          {failure}
        </FormMessage>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" className="h-11" disabled={saving} aria-busy={saving}>
          {saving ? 'Reading the rows…' : 'Read the rows'}
        </Button>
      </div>
    </form>
  );
}

function Choice({
  name,
  checked,
  onSelect,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  description: string;
}): ReactNode {
  return (
    <label className="relative min-w-0">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={(event) => {
          if (event.target.checked) onSelect();
        }}
        className="peer sr-only"
      />
      <span className="flex h-full cursor-pointer flex-col gap-1 rounded-xl border bg-card p-3 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-60 hover:bg-muted/60">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

/** The first rows exactly as in the file (as text), so the person can check the mapping. */
function SampleTable({ batch }: { batch: ImportBatchDetailDto }): ReactNode {
  if (batch.sampleRows.length === 0) {
    return <p className="text-sm text-muted-foreground">The file has no rows to show.</p>;
  }
  return (
    // Wide statements scroll inside this box; the page itself never scrolls sideways.
    <div
      className="max-w-full overflow-x-auto rounded-xl border bg-card"
      role="region"
      aria-label="First rows of the statement"
      tabIndex={0}
    >
      <table className="w-max min-w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            {batch.columns.map((name, index) => (
              <th key={index} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {batch.sampleRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {batch.columns.map((_, index) => (
                <td
                  key={index}
                  title={row[index]}
                  className={cn('max-w-64 truncate px-3 py-2 whitespace-nowrap')}
                >
                  {row[index] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
