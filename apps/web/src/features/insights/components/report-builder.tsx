'use client';

import type { AiReportKind, FinancialReportDto } from '@calmcash/shared';
import { FileText, LoaderCircle, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { AssistantBlocks } from '@/features/ai/components/assistant-blocks';
import type { DashboardSelection } from '@/features/dashboard';
import { formatDateTime } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { createReport } from '@/services/ai.service';

import { REPORT_KINDS } from '../insights-presentation';

/**
 * On-demand reports for the selected period. Sections come from the same services as the pages;
 * the assistant adds a short explanation when it is available (fixed wording otherwise). Reports
 * are created when asked for and never stored.
 */
export function ReportBuilder({
  selection,
  timeZone,
}: {
  selection: DashboardSelection;
  timeZone: string;
}): ReactNode {
  const [kind, setKind] = useState<AiReportKind>('period');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<FinancialReportDto | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const description = REPORT_KINDS.find((entry) => entry.value === kind)?.description;

  const create = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      setReport(await createReport({ kind, ...selection }));
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="reports-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="reports-heading"
        title="Reports"
        description="A summary for the period chosen above, made when you ask for it."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Report
          <NativeSelect
            aria-label="Report"
            className="h-11 text-foreground sm:h-10 sm:w-64"
            value={kind}
            onChange={(event) => {
              const next = REPORT_KINDS.find((entry) => entry.value === event.target.value);
              if (next !== undefined) setKind(next.value);
            }}
          >
            {REPORT_KINDS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          type="button"
          className="h-11 sm:h-10"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <FileText aria-hidden="true" />
          )}
          {busy ? 'Preparing…' : 'Create report'}
        </Button>
      </div>
      {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
      {failure !== undefined && (
        <FormMessage tone="error" title="The report could not be created">
          {failure}
        </FormMessage>
      )}
      {report !== undefined && (
        <Card className="flex flex-col gap-4 p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold">{report.title}</h3>
              <p className="text-xs text-muted-foreground">
                Created {formatDateTime(report.generatedAt, timeZone)}
                {report.currency === undefined ? '' : ` · ${report.currency}`}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => {
                window.print();
              }}
            >
              <Printer aria-hidden="true" />
              Print
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm whitespace-pre-wrap">{report.narrative}</p>
            <p className="text-xs text-muted-foreground">
              {report.narrativeSource === 'assistant'
                ? 'Summary worded by the assistant from the figures below.'
                : 'Standard summary wording.'}
            </p>
          </div>
          <AssistantBlocks blocks={report.sections} timeZone={timeZone} />
        </Card>
      )}
    </section>
  );
}
