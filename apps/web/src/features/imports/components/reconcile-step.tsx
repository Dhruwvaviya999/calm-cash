'use client';

import type {
  BalanceCheckDto,
  ImportBatchDetailDto,
  ImportReconciliationDto,
} from '@calmcash/shared';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type SubmitEvent, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { MoneyInput } from '@/components/forms/money-input';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime, formatMoney } from '@/lib/format';
import { describeRequestError, describeRequestProblems } from '@/lib/form-errors';
import {
  finishImport,
  getImportReconciliation,
  recordImportAdjustment,
  saveImportSettings,
} from '@/services/imports.service';

import { describeBalance, describeDifference, describeUnavailable } from '../import-presentation';
import {
  balancesAreOwed,
  buildSettingsInput,
  initialMappingValues,
  type MappingFormErrors,
  type MappingFormValues,
} from '../import-settings-model';

export interface ReconcileStepProps {
  batch: ImportBatchDetailDto;
  timeZone: string;
  onBatchChanged: () => void;
  onBack: () => void;
}

type StatementValues = Pick<
  MappingFormValues,
  'periodStart' | 'periodEnd' | 'openingBalance' | 'closingBalance'
>;

/**
 * The statement's own balances against the ledger at the same instant (the end of the statement's
 * last day, not today). A difference is explained, never corrected automatically: a correction is
 * recorded only when the person approves it, through the existing reconciliation.
 */
export function ReconcileStep({
  batch,
  timeZone,
  onBatchChanged,
  onBack,
}: ReconcileStepProps): ReactNode {
  const check = useAsyncResource(
    useCallback((signal: AbortSignal) => getImportReconciliation(batch.id, signal), [batch.id]),
  );
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string }>();
  const [confirming, setConfirming] = useState<'adjust' | 'complete' | 'cancel' | undefined>();
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<string | undefined>): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      const message = await action();
      if (message !== undefined) setNotice({ tone: 'success', message });
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    } finally {
      setBusy(false);
      check.refresh();
      onBatchChanged();
    }
  };

  let content: ReactNode;
  if (check.state.status === 'loading') {
    content = (
      <div role="status" aria-live="polite" className="rounded-2xl border bg-card px-4 py-2">
        <span className="sr-only">Comparing the statement with your ledger…</span>
        <ListSkeleton rows={3} />
      </div>
    );
  } else if (check.state.status === 'error') {
    content = (
      <ErrorState
        title="The balances could not be compared"
        description={describeRequestError(check.state.error)}
        onRetry={check.reload}
      />
    );
  } else {
    const result = check.state.data;
    content = (
      <Comparison
        batch={batch}
        result={result}
        timeZone={timeZone}
        busy={busy}
        onBack={onBack}
        onAdjust={() => {
          setConfirming('adjust');
        }}
      />
    );
  }

  const closing = check.state.status === 'success' ? check.state.data.closing : undefined;
  const unresolved = check.state.status === 'success' ? check.state.data.unresolvedRows : 0;

  return (
    <div className="flex flex-col gap-6">
      <StatementForm
        key={batch.updatedAt}
        batch={batch}
        onSaved={() => {
          check.refresh();
          onBatchChanged();
        }}
      />

      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
      {content}

      <section
        aria-labelledby="finish-heading"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <SectionHeader
          id="finish-heading"
          title="Finish"
          description="Finishing keeps every imported transaction and discards the raw statement text kept for review."
        />
        {unresolved > 0 && (
          <FormMessage tone="info">
            {unresolved === 1 ? '1 row has' : `${String(unresolved)} rows have`} not been imported,
            matched, or skipped. Finishing leaves {unresolved === 1 ? 'it' : 'them'} out.
          </FormMessage>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="lg"
            className="h-11"
            disabled={busy}
            onClick={() => {
              setConfirming('complete');
            }}
          >
            Finish import
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="h-11 text-expense hover:text-expense"
            disabled={busy}
            onClick={() => {
              setConfirming('cancel');
            }}
          >
            Cancel import
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirming === 'adjust' && closing?.status === 'available'}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title="Record a balance correction?"
        description={
          closing?.status === 'available'
            ? `A balance adjustment of ${formatMoney(BigInt(closing.differenceMinor), batch.currency)} dated ${formatDateTime(closing.asOf, timeZone)} will be recorded on ${batch.account.name}, so the ledger matches the statement. It is an ordinary transaction that you can void later.`
            : ''
        }
        confirmLabel="Record the correction"
        onConfirm={() => {
          setConfirming(undefined);
          if (closing?.status !== 'available') return;
          void act(async () => {
            await recordImportAdjustment(batch.id, {
              expectedAdjustmentMinor: closing.differenceMinor,
              description: `Statement reconciliation: ${batch.fileName}`.slice(0, 255),
            });
            return 'The correction was recorded. The ledger now matches the statement.';
          });
        }}
      />
      <ConfirmDialog
        open={confirming === 'complete'}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title="Finish this import?"
        description="Imported and matched rows stay as they are. Rows that were not imported cannot be imported from this statement afterwards."
        confirmLabel="Finish import"
        onConfirm={() => {
          setConfirming(undefined);
          void act(async () => {
            await finishImport(batch.id, 'complete');
            return undefined;
          });
        }}
      />
      <ConfirmDialog
        open={confirming === 'cancel'}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title="Cancel this import?"
        description="Nothing more will be imported from this statement. Transactions already imported stay in your ledger; void them there if you do not want them."
        confirmLabel="Cancel import"
        cancelLabel="Keep working"
        destructive
        onConfirm={() => {
          setConfirming(undefined);
          void act(async () => {
            await finishImport(batch.id, 'cancel');
            return undefined;
          });
        }}
      />
    </div>
  );
}

function StatementForm({
  batch,
  onSaved,
}: {
  batch: ImportBatchDetailDto;
  onSaved: () => void;
}): ReactNode {
  const initial = initialMappingValues(batch);
  const [values, setValues] = useState<StatementValues>({
    periodStart: initial.periodStart,
    periodEnd: initial.periodEnd,
    openingBalance: initial.openingBalance,
    closingBalance: initial.closingBalance,
  });
  const [errors, setErrors] = useState<MappingFormErrors>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const owed = balancesAreOwed(batch.account.type);

  const set = (key: keyof StatementValues, value: string): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    // The column settings are sent unchanged, so the rows stay exactly as they are.
    const built = buildSettingsInput(
      { ...initial, ...values },
      {
        columnCount: batch.columns.length,
        currency: batch.currency,
        accountType: batch.account.type,
      },
    );
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setSaving(true);
    try {
      await saveImportSettings(batch.id, built.input);
      onSaved();
    } catch (error: unknown) {
      setFailure(describeRequestProblems(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      aria-labelledby="statement-form-heading"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
    >
      <SectionHeader
        id="statement-form-heading"
        title="From the statement"
        description="The period and balances printed on the statement. Leave a balance empty if the statement has none."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField id="rec-periodStart" label="First day" error={errors.periodStart}>
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
        <FormField id="rec-periodEnd" label="Last day" error={errors.periodEnd}>
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
          id="rec-openingBalance"
          label={owed ? 'Amount owed at the start' : 'Opening balance'}
          error={errors.openingBalance}
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
          id="rec-closingBalance"
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
      {failure !== undefined && <FormMessage tone="error">{failure}</FormMessage>}
      <Button
        type="submit"
        variant="outline"
        className="h-11 self-start sm:h-9"
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? 'Saving…' : 'Save and compare'}
      </Button>
    </form>
  );
}

function BalanceCard({
  title,
  check,
  batch,
  timeZone,
}: {
  title: string;
  check: BalanceCheckDto;
  batch: ImportBatchDetailDto;
  timeZone: string;
}): ReactNode {
  if (check.status === 'unavailable') {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <StatusBadge tone="neutral" className="self-start">
          Not compared
        </StatusBadge>
        <p className="text-sm text-muted-foreground">{describeUnavailable(check)}</p>
      </div>
    );
  }
  const matches = check.differenceMinor === '0';
  const type = batch.account.type;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <StatusBadge tone={matches ? 'positive' : 'warning'}>
          {matches ? 'Matches' : 'Differs'}
        </StatusBadge>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">Statement</dt>
          <dd className="font-medium tabular-nums">
            {describeBalance(check.statementBalanceMinor, batch.currency, type)}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">Your ledger</dt>
          <dd className="font-medium tabular-nums">
            {describeBalance(check.ledgerBalanceMinor, batch.currency, type)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        At {formatDateTime(check.asOf, timeZone)}.{' '}
        {describeDifference(check.differenceMinor, batch.currency, type)}
      </p>
    </div>
  );
}

function Comparison({
  batch,
  result,
  timeZone,
  busy,
  onBack,
  onAdjust,
}: {
  batch: ImportBatchDetailDto;
  result: ImportReconciliationDto;
  timeZone: string;
  busy: boolean;
  onBack: () => void;
  onAdjust: () => void;
}): ReactNode {
  const { closing, opening, unresolvedRows } = result;
  const adjustment = result.batch.reconciliation?.adjustmentTransactionId;
  const differs = closing.status === 'available' && closing.differenceMinor !== '0';

  return (
    <section aria-labelledby="comparison-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="comparison-heading"
        title="Statement and ledger"
        description="Compared at the statement's own dates, so later transactions do not count."
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BalanceCard title="Opening balance" check={opening} batch={batch} timeZone={timeZone} />
        <BalanceCard title="Closing balance" check={closing} batch={batch} timeZone={timeZone} />
      </div>

      {closing.status === 'available' && !differs && (
        <FormMessage tone="success">
          Your ledger matches the statement&apos;s closing balance.
        </FormMessage>
      )}

      {adjustment !== undefined && (
        <FormMessage tone="info">
          A balance correction was recorded for this statement.{' '}
          <Link
            href={`/transactions?transaction=${adjustment}`}
            className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
          >
            Open it
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </FormMessage>
      )}

      {differs && (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <h3 className="text-sm font-semibold">Before correcting the balance</h3>
          <ul className="list-disc pl-5 text-sm">
            {unresolvedRows > 0 && (
              <li>
                {unresolvedRows === 1 ? '1 row is' : `${String(unresolvedRows)} rows are`} still
                waiting to be imported, matched, or skipped. Resolving them may explain the
                difference.
              </li>
            )}
            <li>Look for a fee, interest, or a payment that is in only one of the two.</li>
            <li>Look for a transaction recorded twice, or on a date outside the statement.</li>
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            {unresolvedRows > 0 && (
              <Button variant="outline" className="h-11 sm:h-9" onClick={onBack}>
                <ArrowLeft aria-hidden="true" />
                Back to the rows
              </Button>
            )}
            <Button variant="outline" className="h-11 sm:h-9" disabled={busy} onClick={onAdjust}>
              Record a correction of {formatMoney(BigInt(closing.differenceMinor), batch.currency)}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
