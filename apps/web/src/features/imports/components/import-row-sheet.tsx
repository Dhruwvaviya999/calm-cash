'use client';

import {
  PAYMENT_METHODS,
  type DuplicateCandidateDto,
  type ImportBatchDetailDto,
  type ImportRowDecisionInput,
  type ImportRowDto,
  type PaymentMethod,
  type UpdateImportRowInput,
} from '@calmcash/shared';
import { ExternalLink, Link2, SkipForward, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { SideSheet } from '@/components/layout/side-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { CategorySelect } from '@/features/transactions';
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_LABELS } from '@/lib/finance-presentation';
import { formatDate, formatDateTime, formatMoneyMagnitude } from '@/lib/format';
import { describeRequestError, describeRequestProblems } from '@/lib/form-errors';
import { decideImportRow, updateImportRow } from '@/services/imports.service';

import { describeDuplicate, isEditable, ROW_STATUS_PRESENTATION } from '../import-presentation';
import type { ImportReferences } from './import-wizard';

export interface ImportRowSheetProps {
  batch: ImportBatchDetailDto;
  row: ImportRowDto | undefined;
  references: ImportReferences;
  timeZone: string;
  readOnly: boolean;
  onClose: () => void;
  onChanged: (row: ImportRowDto) => void;
}

/** One statement row: what the file says, possible duplicates, and what will be recorded. */
export function ImportRowSheet({ row, onClose, ...props }: ImportRowSheetProps): ReactNode {
  return (
    <SideSheet
      open={row !== undefined}
      onClose={onClose}
      title={row === undefined ? 'Statement row' : `Line ${String(row.rowNumber)}`}
      description={row === undefined ? undefined : ROW_STATUS_PRESENTATION[row.status].label}
    >
      {row !== undefined && <RowDetails key={`${row.id}-${row.status}`} row={row} {...props} />}
    </SideSheet>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

function RowDetails({
  batch,
  row,
  references,
  timeZone,
  readOnly,
  onChanged,
}: Omit<ImportRowSheetProps, 'row' | 'onClose'> & { row: ImportRowDto }): ReactNode {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const status = ROW_STATUS_PRESENTATION[row.status];
  const open = !readOnly;

  const decide = async (input: ImportRowDecisionInput): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      onChanged(await decideImportRow(batch.id, row.id, input));
    } catch (failure: unknown) {
      setError(describeRequestError(failure));
    } finally {
      setBusy(false);
    }
  };

  const linkedTransaction =
    row.status === 'imported' || row.status === 'matched' ? row.transactionId : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <StatusBadge tone={status.tone} className="self-start">
          {status.label}
        </StatusBadge>
        {row.amountMinor !== undefined && row.direction !== undefined && (
          <FinancialAmount
            amountMinor={row.amountMinor}
            currency={batch.currency}
            direction={row.direction === 'credit' ? 'credit' : 'debit'}
            size="lg"
          />
        )}
      </div>

      <section aria-labelledby="row-facts-heading" className="flex flex-col gap-2">
        <h3 id="row-facts-heading" className="text-sm font-semibold">
          In the statement
        </h3>
        <dl className="divide-y border-y">
          <Fact label="Date">
            {row.date === undefined ? 'Not readable' : formatDate(row.date, 'dayMonthYear')}
          </Fact>
          <Fact label="Description">{row.description || 'None'}</Fact>
          {row.counterparty !== undefined && <Fact label="Payee or payer">{row.counterparty}</Fact>}
          {row.reference !== undefined && <Fact label="Reference">{row.reference}</Fact>}
          {row.direction !== undefined && (
            <Fact label="Direction">{row.direction === 'debit' ? 'Money out' : 'Money in'}</Fact>
          )}
        </dl>
      </section>

      {row.status === 'invalid' && (
        <FormMessage tone="error" title="This row cannot be read">
          <ul className="list-disc pl-5">
            {row.problems.map((problem, index) => (
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
          <p className="mt-2">Change how the columns are read, or skip this row.</p>
        </FormMessage>
      )}
      {row.status === 'failed' && (
        <FormMessage tone="error" title="This row was not imported">
          {row.error} Nothing was recorded. Change it below and import it again, or skip it.
        </FormMessage>
      )}
      {row.warnings.length > 0 && (
        <FormMessage tone="info">
          <ul className="list-disc pl-5">
            {row.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </FormMessage>
      )}
      {linkedTransaction !== undefined && (
        <FormMessage tone="success">
          {row.status === 'imported'
            ? 'A transaction was recorded from this row.'
            : 'This row is linked to a transaction you had already recorded. Nothing new was recorded.'}{' '}
          <Link
            href={`/transactions?transaction=${linkedTransaction}`}
            className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
          >
            Open the transaction
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </FormMessage>
      )}

      {row.duplicates.length > 0 && (
        <section aria-labelledby="row-duplicates-heading" className="flex flex-col gap-3">
          <h3 id="row-duplicates-heading" className="text-sm font-semibold">
            Possible duplicates
          </h3>
          {row.duplicateDismissed && (
            <p className="text-sm text-muted-foreground">You said this row is not a duplicate.</p>
          )}
          <ul className="flex flex-col gap-2">
            {row.duplicates.map((candidate, index) => (
              <Candidate
                key={index}
                candidate={candidate}
                timeZone={timeZone}
                canMatch={
                  open &&
                  (row.status === 'review' || row.status === 'ready' || row.status === 'failed') &&
                  !busy
                }
                onMatch={(transactionId) => void decide({ action: 'match', transactionId })}
              />
            ))}
          </ul>
        </section>
      )}

      {error !== undefined && <FormMessage tone="error">{error}</FormMessage>}

      {open && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {row.status === 'review' && (
            <Button
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => void decide({ action: 'not_duplicate' })}
            >
              Not a duplicate
            </Button>
          )}
          {(row.status === 'review' ||
            row.status === 'ready' ||
            row.status === 'failed' ||
            row.status === 'invalid') && (
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => void decide({ action: 'skip' })}
            >
              <SkipForward aria-hidden="true" />
              Skip this row
            </Button>
          )}
          {(row.status === 'skipped' || row.status === 'matched') && (
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => void decide({ action: 'restore' })}
            >
              <Undo2 aria-hidden="true" />
              {row.status === 'matched' ? 'Undo the match' : 'Include this row again'}
            </Button>
          )}
        </div>
      )}

      {open && isEditable(row) && row.proposal !== undefined && row.direction !== undefined && (
        <ProposalForm
          batch={batch}
          row={row}
          proposal={row.proposal}
          direction={row.direction}
          references={references}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

function Candidate({
  candidate,
  timeZone,
  canMatch,
  onMatch,
}: {
  candidate: DuplicateCandidateDto;
  timeZone: string;
  canMatch: boolean;
  onMatch: (transactionId: string) => void;
}): ReactNode {
  const { transaction } = candidate;
  return (
    <li className="flex flex-col gap-2 rounded-xl border px-3 py-3">
      <p className="text-sm">{describeDuplicate(candidate)}</p>
      {transaction !== undefined && (
        <>
          <div className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium break-words">
                {transaction.merchant ?? transaction.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {TRANSACTION_TYPE_LABELS[transaction.type]} ·{' '}
                {formatDateTime(transaction.occurredAt, timeZone)}
                {transaction.status === 'voided' ? ' · voided' : ''}
              </p>
            </div>
            <span className="shrink-0 font-medium tabular-nums">
              {formatMoneyMagnitude(transaction.amountMinor, transaction.currency)}
            </span>
          </div>
          {canMatch &&
            candidate.reason === 'existing_transaction' &&
            transaction.status === 'active' && (
              <Button
                variant="outline"
                size="sm"
                className="h-11 self-start sm:h-8"
                onClick={() => {
                  onMatch(transaction.id);
                }}
              >
                <Link2 aria-hidden="true" />
                It is this transaction
              </Button>
            )}
        </>
      )}
    </li>
  );
}

interface ProposalValues {
  type: 'expense' | 'income' | 'transfer';
  categoryId: string;
  transferAccountId: string;
  description: string;
  merchant: string;
  paymentMethod: PaymentMethod | '';
  notes: string;
}

function ProposalForm({
  batch,
  row,
  proposal,
  direction,
  references,
  onSaved,
}: {
  batch: ImportBatchDetailDto;
  row: ImportRowDto;
  proposal: NonNullable<ImportRowDto['proposal']>;
  direction: NonNullable<ImportRowDto['direction']>;
  references: ImportReferences;
  onSaved: (row: ImportRowDto) => void;
}): ReactNode {
  const [values, setValues] = useState<ProposalValues>({
    type: proposal.type,
    categoryId: proposal.categoryId ?? '',
    transferAccountId: proposal.transferAccountId ?? '',
    description: proposal.description,
    merchant: proposal.merchant ?? '',
    paymentMethod: proposal.paymentMethod ?? '',
    notes: proposal.notes ?? '',
  });
  const [failure, setFailure] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const own: 'expense' | 'income' = direction === 'debit' ? 'expense' : 'income';
  const otherAccounts = references.accounts
    .map((entry) => entry.account)
    .filter(
      (account) =>
        account.id !== batch.account.id &&
        account.status === 'active' &&
        account.currency === batch.currency,
    );

  const set = <TKey extends keyof ProposalValues>(key: TKey, value: ProposalValues[TKey]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    if (values.description.trim() === '') {
      setFailure('Describe what this was for.');
      return;
    }
    const patch: UpdateImportRowInput = {
      type: values.type,
      description: values.description.trim(),
      notes: values.notes.trim() === '' ? null : values.notes.trim(),
      paymentMethod: values.paymentMethod === '' ? null : values.paymentMethod,
      ...(values.type === 'transfer'
        ? { transferAccountId: values.transferAccountId === '' ? null : values.transferAccountId }
        : {
            categoryId: values.categoryId === '' ? null : values.categoryId,
            merchant: values.merchant.trim() === '' ? null : values.merchant.trim(),
          }),
    };
    setSaving(true);
    try {
      onSaved(await updateImportRow(batch.id, row.id, patch));
    } catch (error: unknown) {
      setFailure(describeRequestProblems(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      aria-labelledby="row-proposal-heading"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4 rounded-2xl border bg-card/60 p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h3 id="row-proposal-heading" className="text-sm font-semibold">
          What will be recorded
        </h3>
        {proposal.suggested && (
          <p className="text-xs text-muted-foreground">
            The category or payee was suggested from your earlier transactions. Check it.
          </p>
        )}
      </div>
      <FormField id="row-type" label="Type">
        {(control) => (
          <NativeSelect
            {...control}
            value={values.type}
            onChange={(event) => {
              set('type', event.target.value === 'transfer' ? 'transfer' : own);
            }}
          >
            <option value={own}>{own === 'expense' ? 'Expense' : 'Income'}</option>
            <option value="transfer">
              {direction === 'debit'
                ? 'Transfer to another account'
                : 'Transfer from another account'}
            </option>
          </NativeSelect>
        )}
      </FormField>
      {values.type === 'transfer' ? (
        <FormField
          id="row-transfer-account"
          label={direction === 'debit' ? 'To account' : 'From account'}
          hint={`Active accounts in ${batch.currency}.`}
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={values.transferAccountId}
              onChange={(event) => {
                set('transferAccountId', event.target.value);
              }}
            >
              <option value="">Choose an account</option>
              {otherAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <>
          <FormField id="row-category" label="Category">
            {(control) => (
              <CategorySelect
                {...control}
                categories={references.categories}
                kind={values.type === 'income' ? 'income' : 'expense'}
                placeholder="Choose a category"
                value={values.categoryId}
                onChange={(event) => {
                  set('categoryId', event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            id="row-merchant"
            label={own === 'expense' ? 'Paid to (optional)' : 'Received from (optional)'}
          >
            {(control) => (
              <Input
                {...control}
                className="h-11"
                value={values.merchant}
                maxLength={120}
                onChange={(event) => {
                  set('merchant', event.target.value);
                }}
              />
            )}
          </FormField>
        </>
      )}
      <FormField id="row-description" label="Purpose">
        {(control) => (
          <Input
            {...control}
            className="h-11"
            value={values.description}
            maxLength={255}
            onChange={(event) => {
              set('description', event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField id="row-method" label="Payment method (optional)">
        {(control) => (
          <NativeSelect
            {...control}
            value={values.paymentMethod}
            onChange={(event) => {
              set(
                'paymentMethod',
                PAYMENT_METHODS.find((method) => method === event.target.value) ?? '',
              );
            }}
          >
            <option value="">Not recorded</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="row-notes" label="Notes (optional)">
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={values.notes}
            maxLength={2000}
            onChange={(event) => {
              set('notes', event.target.value);
            }}
          />
        )}
      </FormField>
      {failure !== undefined && <FormMessage tone="error">{failure}</FormMessage>}
      <Button type="submit" className="h-11 self-start sm:h-9" disabled={saving} aria-busy={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
