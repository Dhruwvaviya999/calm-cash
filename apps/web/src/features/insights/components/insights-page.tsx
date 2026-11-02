'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { describeAiProblem } from '@/features/ai/ai-presentation';
import { useAiStatus } from '@/features/ai/use-ai-status';
import { useSignedInSession } from '@/features/auth';

import { useInsightsSelection } from '../use-insights-selection';
import { RecurringCandidates } from './recurring-candidates';
import { ReportBuilder } from './report-builder';
import { SpendingInsights } from './spending-insights';
import { TidyUp } from './tidy-up';

/**
 * Insights: spending patterns, possible bills and subscriptions, tidy-up suggestions, and reports.
 * Every figure is computed by CalmCash from recorded transactions; the assistant only explains,
 * suggests, and words summaries, and nothing changes until the person acts.
 */
export function InsightsPage(): ReactNode {
  const { user } = useSignedInSession();
  const { selection, query, setSelection } = useInsightsSelection();
  const status = useAiStatus();
  const aiAvailable = status.state.status === 'success' && status.state.data.available;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Insights"
        description="Patterns in your money, worked out from your own records."
        actions={
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <Link href="/assistant">Ask the assistant</Link>
          </Button>
        }
      />

      {status.state.status === 'success' && !status.state.data.available && (
        <p className="-mt-6 text-sm text-muted-foreground">
          {describeAiProblem(status.state.data.problem ?? 'unreachable', status.state.data.model)}{' '}
          Patterns, repeating payments, history-based suggestions, and reports still work.
        </p>
      )}

      <SpendingInsights
        selection={selection}
        query={query}
        timeZone={user.timezone}
        aiAvailable={aiAvailable}
        onSelectionChange={setSelection}
      />
      <RecurringCandidates />
      <TidyUp />
      <ReportBuilder selection={selection} timeZone={user.timezone} />
    </div>
  );
}
