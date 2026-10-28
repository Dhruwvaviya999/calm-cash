'use client';

import {
  CSV_DELIMITERS,
  MAX_STATEMENT_FILE_BYTES,
  MAX_STATEMENT_ROWS,
  type AccountDto,
  type CsvDelimiter,
} from '@calmcash/shared';
import { FileUp, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { ACCOUNT_TYPE_PRESENTATION } from '@/lib/finance-presentation';
import { formatBytes } from '@/lib/format';
import { describeRequestError, describeRequestProblems } from '@/lib/form-errors';
import { listAccounts } from '@/services/accounts.service';
import { uploadStatement } from '@/services/imports.service';

const DELIMITER_LABELS: Readonly<Record<CsvDelimiter, string>> = {
  ',': 'Comma (,)',
  ';': 'Semicolon (;)',
  '\t': 'Tab',
  '|': 'Vertical bar (|)',
};

function isDelimiter(value: string): value is CsvDelimiter {
  return CSV_DELIMITERS.some((delimiter) => delimiter === value);
}

const loadAccounts = async (signal: AbortSignal): Promise<AccountDto[]> =>
  (await listAccounts('active', signal)).accounts.map((entry) => entry.account);

interface Errors {
  account?: string | undefined;
  file?: string | undefined;
}

/**
 * Starts an import: the account the statement belongs to and the CSV file. The file is read once
 * by the API into rows to review; nothing is recorded until rows are approved.
 */
export function NewImportForm(): ReactNode {
  const router = useRouter();
  const accounts = useAsyncResource(loadAccounts);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [delimiter, setDelimiter] = useState('');
  const [header, setHeader] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFailure(undefined);
    const next: Errors = {};
    if (accountId === '') {
      next.account = 'Choose the account this statement belongs to.';
    }
    if (file === undefined) {
      next.file = 'Choose a CSV statement file.';
    } else if (file.size === 0) {
      next.file = 'This file is empty.';
    } else if (file.size > MAX_STATEMENT_FILE_BYTES) {
      next.file = `This file is ${formatBytes(file.size)}. Statements can be at most 2 MB; split a long statement into shorter periods.`;
    }
    setErrors(next);
    if (next.account !== undefined || next.file !== undefined || file === undefined) {
      return;
    }
    setSubmitting(true);
    try {
      const batch = await uploadStatement({
        accountId,
        file,
        delimiter: isDelimiter(delimiter) ? delimiter : undefined,
        hasHeaderRow: header === '' ? undefined : header === 'yes',
      });
      router.push(`/imports?batch=${batch.id}`);
    } catch (error: unknown) {
      setFailure(describeRequestProblems(error));
      setSubmitting(false);
    }
  };

  let body: ReactNode;
  if (accounts.state.status === 'loading') {
    body = (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading your accounts…</span>
        <ListSkeleton rows={2} />
      </div>
    );
  } else if (accounts.state.status === 'error') {
    body = (
      <FormMessage tone="error">
        Your accounts could not be loaded. {describeRequestError(accounts.state.error)}{' '}
        <Button variant="link" className="h-auto p-0" onClick={accounts.reload}>
          Try again
        </Button>
      </FormMessage>
    );
  } else if (accounts.state.data.length === 0) {
    body = (
      <EmptyState
        icon={WalletCards}
        title="Add an account first"
        description="A statement is imported into one of your accounts. Add the bank account or card it belongs to, then come back."
        headingLevel="h3"
      >
        <Button asChild size="lg" className="h-11">
          <Link href="/accounts">Go to accounts</Link>
        </Button>
      </EmptyState>
    );
  } else {
    const list = accounts.state.data;
    body = (
      <form
        noValidate
        aria-label="Import a statement"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <FormField
            id="import-account"
            label="Account"
            error={errors.account}
            hint="Amounts are read in this account's currency."
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={accountId}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setErrors((current) => ({ ...current, account: undefined }));
                }}
              >
                <option value="">Choose an account</option>
                {list.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({ACCOUNT_TYPE_PRESENTATION[account.type].label},{' '}
                    {account.currency})
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="import-file"
            label="Statement file (CSV)"
            error={errors.file}
            hint={`Up to 2 MB and ${MAX_STATEMENT_ROWS.toLocaleString('en-IN')} rows.`}
          >
            {(control) => (
              <input
                {...control}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(event) => {
                  setFile(event.target.files?.[0]);
                  setErrors((current) => ({ ...current, file: undefined }));
                }}
                className="block h-11 w-full min-w-0 rounded-md border border-input bg-transparent text-sm shadow-xs file:mr-3 file:h-full file:border-0 file:border-r file:bg-muted file:px-3 file:text-sm file:font-medium file:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive dark:bg-input/30"
              />
            )}
          </FormField>
        </div>

        <details className="group rounded-xl border bg-card/60 px-4 py-3">
          <summary className="cursor-pointer rounded-sm text-sm font-medium outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            File layout
            <span className="ml-1 font-normal text-muted-foreground">(detected automatically)</span>
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormField id="import-delimiter" label="Values separated by">
              {(control) => (
                <NativeSelect
                  {...control}
                  value={delimiter}
                  onChange={(event) => {
                    setDelimiter(event.target.value);
                  }}
                >
                  <option value="">Detect from the file</option>
                  {CSV_DELIMITERS.map((value) => (
                    <option key={value} value={value}>
                      {DELIMITER_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id="import-header" label="First row has column names">
              {(control) => (
                <NativeSelect
                  {...control}
                  value={header}
                  onChange={(event) => {
                    setHeader(event.target.value);
                  }}
                >
                  <option value="">Detect from the file</option>
                  <option value="yes">Yes</option>
                  <option value="no">No, it is already a transaction</option>
                </NativeSelect>
              )}
            </FormField>
          </div>
        </details>

        {failure !== undefined && (
          <FormMessage tone="error" title="The statement could not be read">
            {failure}
          </FormMessage>
        )}

        <div>
          <Button
            type="submit"
            size="lg"
            className="h-11"
            disabled={submitting}
            aria-busy={submitting}
          >
            <FileUp aria-hidden="true" />
            {submitting ? 'Reading the statement…' : 'Upload and continue'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section
      aria-labelledby="new-import-heading"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
    >
      <SectionHeader
        id="new-import-heading"
        title="Import a statement"
        description="CSV statements from any bank. OFX and PDF statements are not supported yet."
      />
      {body}
    </section>
  );
}
