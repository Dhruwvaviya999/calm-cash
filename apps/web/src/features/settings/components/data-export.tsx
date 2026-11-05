'use client';

import { Download, LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { describeRequestError } from '@/lib/form-errors';
import { downloadFinancialData } from '@/services/data-export.service';

/** Today's date in the browser, for the file name (the export itself records its own time). */
function fileName(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `calmcash-export-${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Downloads everything CalmCash holds about the person's money as a JSON file: profile,
 * accounts, transactions, plans, imports, receipt details, notifications, AI conversations, and
 * scenarios. Amounts are exact (minor units as text). Receipt images and PDFs stay downloadable
 * one by one from their transactions. The file is built on request and never stored.
 */
export function DataExport(): ReactNode {
  const [state, setState] = useState<
    { status: 'idle' | 'working' | 'done' } | { status: 'error'; message: string }
  >({ status: 'idle' });

  const download = async (): Promise<void> => {
    setState({ status: 'working' });
    try {
      const blob = await downloadFinancialData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName();
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      setState({ status: 'done' });
    } catch (error: unknown) {
      setState({ status: 'error', message: describeRequestError(error) });
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        A JSON file with your profile, accounts, transactions, budgets, recurring payments, goals,
        statement imports, receipt details, notifications, assistant conversations, and scenarios.
        Amounts are exact, in minor units (paise, cents). It contains your financial history, so
        keep it somewhere private.
      </p>
      <Button
        type="button"
        variant="outline"
        className="h-11 self-start sm:h-9"
        disabled={state.status === 'working'}
        onClick={() => void download()}
      >
        {state.status === 'working' ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {state.status === 'working' ? 'Preparing your data…' : 'Download my data'}
      </Button>
      {state.status === 'done' && (
        <p role="status" className="text-muted-foreground">
          Your download has started.
        </p>
      )}
      {state.status === 'error' && (
        <FormMessage tone="error" title="The download did not complete">
          {state.message}
        </FormMessage>
      )}
    </div>
  );
}
