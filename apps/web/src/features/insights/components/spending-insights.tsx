'use client';

import type { InsightListDto, SpendingInsightDto } from '@calmcash/shared';
import { ArrowRight, EyeOff, LoaderCircle, MessageCircleQuestion, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { assistantHref } from '@/features/ai/ai-presentation';
import { DashboardControls, type DashboardSelection } from '@/features/dashboard';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { explainInsight } from '@/services/ai.service';
import { dismissInsight, listInsights } from '@/services/insights.service';

import { INSIGHT_KIND_PRESENTATION } from '../insights-presentation';

function describePeriod(period: { from: string; to: string }): string {
  return `${formatDate(period.from, 'dayMonth')} – ${formatDate(period.to, 'dayMonthYear')}`;
}

function InsightCard({
  insight,
  selection,
  aiAvailable,
  onDismissed,
}: {
  insight: SpendingInsightDto;
  selection: DashboardSelection;
  aiAvailable: boolean;
  onDismissed: () => void;
}): ReactNode {
  const { label, icon: Icon } = INSIGHT_KIND_PRESENTATION[insight.kind];
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<
    { text: string; worded: boolean } | { failure: string } | undefined
  >();
  const [dismissing, setDismissing] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const explain = async (): Promise<void> => {
    setExplaining(true);
    try {
      const result = await explainInsight({ key: insight.key, ...selection });
      setExplanation({ text: result.explanation, worded: result.narrative === 'assistant' });
    } catch (error: unknown) {
      setExplanation({ failure: describeRequestError(error) });
    } finally {
      setExplaining(false);
    }
  };

  const dismiss = async (): Promise<void> => {
    setDismissing(true);
    setFailure(undefined);
    try {
      await dismissInsight(insight.key);
      onDismissed();
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
      setDismissing(false);
    }
  };

  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <StatusBadge
              tone={insight.kind === 'unusual_expense' ? 'warning' : 'info'}
              showIcon={false}
            >
              {label}
            </StatusBadge>
            <h3 className="font-medium">{insight.title}</h3>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{insight.detail}</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {insight.figures.map((figure) => (
            <div key={figure.label} className="rounded-lg bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              <dd className="flex flex-wrap items-baseline gap-2">
                {figure.amountMinor !== undefined && (
                  <FinancialAmount
                    amountMinor={figure.amountMinor}
                    currency={insight.currency}
                    size="sm"
                  />
                )}
                {figure.text !== undefined && <span className="text-sm">{figure.text}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {explanation !== undefined && (
          <div aria-live="polite" className="rounded-lg border bg-card px-3 py-2 text-sm">
            {'failure' in explanation ? (
              <p className="text-expense">{explanation.failure}</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{explanation.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {explanation.worded
                    ? 'Worded by the assistant from the figures above.'
                    : 'Standard wording.'}
                </p>
              </>
            )}
          </div>
        )}
        {failure !== undefined && <p className="text-sm text-expense">{failure}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
            <Link href={assistantHref(insight.link.target)}>
              {insight.link.label}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          {aiAvailable && explanation === undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 sm:h-8"
              disabled={explaining}
              onClick={() => void explain()}
            >
              {explaining ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <MessageCircleQuestion aria-hidden="true" />
              )}
              Explain
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            disabled={dismissing}
            aria-label={`Hide: ${insight.title}`}
            onClick={() => void dismiss()}
          >
            <EyeOff aria-hidden="true" />
            Hide
          </Button>
        </div>
      </Card>
    </li>
  );
}

/**
 * Patterns in the chosen period, compared with the period before. Computed by fixed rules from
 * recorded transactions, so they appear whether or not AI is on; the assistant can only explain.
 */
export function SpendingInsights({
  selection,
  query,
  timeZone,
  aiAvailable,
  onSelectionChange,
}: {
  selection: DashboardSelection;
  query: string;
  timeZone: string;
  aiAvailable: boolean;
  onSelectionChange: (selection: DashboardSelection) => void;
}): ReactNode {
  const insights = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<InsightListDto> => listInsights(query, signal),
      [query],
    ),
  );

  return (
    <section aria-labelledby="spending-insights-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="spending-insights-heading"
        title="Spending patterns"
        description="Worked out from your records with fixed rules. They describe what changed, never why."
      />
      {insights.state.status === 'success' && insights.state.data.currency !== undefined && (
        <DashboardControls
          selection={selection}
          currency={insights.state.data.currency}
          currencies={insights.state.data.currencies}
          timeZone={timeZone}
          onChange={onSelectionChange}
        />
      )}
      {insights.state.status === 'loading' && <ListSkeleton rows={3} />}
      {insights.state.status === 'error' && (
        <ErrorState
          title="Insights could not be loaded"
          description={describeRequestError(insights.state.error)}
          onRetry={insights.reload}
        />
      )}
      {insights.state.status === 'success' && (
        <>
          <p className="text-sm text-muted-foreground">
            {describePeriod(insights.state.data.period)}
            {insights.state.data.currency === undefined ? '' : ` · ${insights.state.data.currency}`}
          </p>
          {insights.state.data.items.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              headingLevel="h3"
              title={
                insights.state.data.insufficientHistory
                  ? 'Not enough history yet'
                  : 'Nothing stands out in this period'
              }
              description={
                insights.state.data.insufficientHistory
                  ? 'Patterns need a few weeks of recorded transactions to compare with. Keep recording, or choose a longer period.'
                  : 'No category changed much, and no payment was unusually large compared with your history.'
              }
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {insights.state.data.items.map((insight) => (
                <InsightCard
                  key={insight.key}
                  insight={insight}
                  selection={selection}
                  aiAvailable={aiAvailable}
                  onDismissed={insights.refresh}
                />
              ))}
            </ul>
          )}
          {insights.state.data.items.length > 0 && insights.state.data.insufficientHistory && (
            <p className="text-xs text-muted-foreground">
              Comparisons get more reliable as more history is recorded.
            </p>
          )}
        </>
      )}
    </section>
  );
}
