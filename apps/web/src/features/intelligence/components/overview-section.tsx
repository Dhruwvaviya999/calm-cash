'use client';

import {
  HEALTH_GROUPS,
  type CurrencyCode,
  type FinancialHealthDto,
  type FinancialRecommendationDto,
  type IntelligenceOverviewDto,
  type RecommendationListDto,
} from '@calmcash/shared';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  EyeOff,
  Landmark,
  Lightbulb,
  PiggyBank,
  Scale,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { StatCard } from '@/components/finance/stat-card';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { assistantHref } from '@/features/ai/ai-presentation';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatBasisPoints, formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  getFinancialHealth,
  getIntelligenceOverview,
  getRecommendations,
  markRecommendation,
} from '@/services/intelligence.service';

import { HEALTH_GROUP_LABELS, PRIORITY_PRESENTATION } from '../intelligence-presentation';
import {
  CalculatedAt,
  ExplainButton,
  FigureKindLabel,
  MethodologyDisclosure,
  SufficiencyBadge,
} from './intelligence-parts';

export function FinancialOverviewSection({
  currency,
  onCurrencies,
}: {
  currency: CurrencyCode | undefined;
  /** Reports the currencies the person uses (for the page's currency switch). */
  onCurrencies: (currencies: CurrencyCode[], shown: CurrencyCode) => void;
}): ReactNode {
  const overview = useAsyncResource(
    useCallback(
      async (signal: AbortSignal): Promise<IntelligenceOverviewDto> => {
        const result = await getIntelligenceOverview(currency, signal);
        onCurrencies(result.currencies, result.currency);
        return result;
      },
      [currency, onCurrencies],
    ),
  );
  const data = overview.state.status === 'success' ? overview.state.data : undefined;
  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="overview-heading"
        title="Financial overview"
        description="Actual figures: this month so far, and what your accounts hold and owe right now."
      />
      {overview.state.status === 'loading' && <ListSkeleton rows={2} />}
      {overview.state.status === 'error' && (
        <ErrorState
          title="The overview could not be loaded"
          description={describeRequestError(overview.state.error)}
          onRetry={overview.reload}
        />
      )}
      {data !== undefined && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <FigureKindLabel kind="actual" />
            {formatDate(data.thisMonth.from, 'dayMonth')} –{' '}
            {formatDate(data.thisMonth.to, 'dayMonthYear')} · {data.currency}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Income"
              icon={ArrowDownLeft}
              tone="income"
              value={
                <FinancialAmount
                  amountMinor={data.incomeMinor}
                  currency={data.currency}
                  size="lg"
                />
              }
              footnote={`Last month: ${formatMoney(data.lastMonth.incomeMinor, data.currency)}`}
            />
            <StatCard
              label="Spending"
              icon={ArrowUpRight}
              tone="expense"
              value={
                <FinancialAmount
                  amountMinor={data.expenseMinor}
                  currency={data.currency}
                  size="lg"
                />
              }
              footnote={`Last month: ${formatMoney(data.lastMonth.expenseMinor, data.currency)}`}
            />
            <StatCard
              label="Net cash flow"
              icon={Scale}
              tone="neutral"
              value={
                <FinancialAmount amountMinor={data.netMinor} currency={data.currency} size="lg" />
              }
              footnote="Income minus spending; transfers are not counted"
            />
            <StatCard
              label="Savings rate"
              icon={PiggyBank}
              tone="savings"
              value={
                <span className="text-2xl font-semibold tabular-nums">
                  {data.savingsRate.status === 'available'
                    ? formatBasisPoints(data.savingsRate.basisPoints)
                    : 'Not available'}
                </span>
              }
              footnote={
                data.savingsRate.status === 'available'
                  ? '(Income − spending) ÷ income'
                  : 'No income recorded this month yet'
              }
            />
            <StatCard
              label="Money held"
              icon={Landmark}
              tone="neutral"
              value={
                <FinancialAmount amountMinor={data.heldMinor} currency={data.currency} size="lg" />
              }
              footnote="Active accounts now"
            />
            <StatCard
              label="Money owed"
              icon={CreditCard}
              tone="neutral"
              value={
                <FinancialAmount amountMinor={data.owedMinor} currency={data.currency} size="lg" />
              }
              footnote="Cards and loans now; never added to money held"
            />
          </div>
        </>
      )}
    </section>
  );
}

export function FinancialHealthSection({
  currency,
  timeZone,
  aiAvailable,
}: {
  currency: CurrencyCode | undefined;
  timeZone: string;
  aiAvailable: boolean;
}): ReactNode {
  const health = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<FinancialHealthDto> => getFinancialHealth(currency, signal),
      [currency],
    ),
  );
  const data = health.state.status === 'success' ? health.state.data : undefined;
  return (
    <section aria-labelledby="health-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="health-heading"
        title="Financial health"
        description="Separate, measurable indicators with their definitions. There is no overall score."
      />
      {health.state.status === 'loading' && <ListSkeleton rows={3} />}
      {health.state.status === 'error' && (
        <ErrorState
          title="Health indicators could not be loaded"
          description={describeRequestError(health.state.error)}
          onRetry={health.reload}
        />
      )}
      {data !== undefined && (
        <>
          {HEALTH_GROUPS.map((group) => {
            const indicators = data.indicators.filter((indicator) => indicator.group === group);
            if (indicators.length === 0) return null;
            return (
              <div key={group} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {HEALTH_GROUP_LABELS[group]}
                </h3>
                <ul className="grid gap-3 md:grid-cols-2">
                  {indicators.map((indicator) => (
                    <li key={indicator.key}>
                      <Card className="flex h-full flex-col gap-2 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h4 className="font-medium">{indicator.title}</h4>
                          {indicator.status === 'available' && (
                            <SufficiencyBadge level={indicator.sufficiency} />
                          )}
                        </div>
                        {indicator.status === 'available' && indicator.headline !== undefined ? (
                          <p className="flex flex-wrap items-baseline gap-2">
                            <span className="text-sm text-muted-foreground">
                              {indicator.headline.label}
                            </span>
                            {indicator.headline.amountMinor !== undefined &&
                              indicator.currency !== undefined && (
                                <FinancialAmount
                                  amountMinor={indicator.headline.amountMinor}
                                  currency={indicator.currency}
                                  size="lg"
                                />
                              )}
                            {indicator.headline.text !== undefined && (
                              <span className="text-xl font-semibold tabular-nums">
                                {indicator.headline.text}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {indicator.unavailableReason ?? 'Not available yet.'}
                          </p>
                        )}
                        {indicator.figures.length > 0 && (
                          <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                            {indicator.figures.map((figure) => (
                              <div key={figure.label} className="flex flex-col">
                                <dt className="text-xs text-muted-foreground">{figure.label}</dt>
                                <dd className="flex flex-wrap items-baseline gap-1">
                                  {figure.amountMinor !== undefined &&
                                    indicator.currency !== undefined && (
                                      <FinancialAmount
                                        amountMinor={figure.amountMinor}
                                        currency={indicator.currency}
                                        size="sm"
                                      />
                                    )}
                                  {figure.text !== undefined && <span>{figure.text}</span>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer select-none hover:text-foreground">
                            How it is defined
                          </summary>
                          <p className="mt-1">{indicator.definition}</p>
                          {indicator.period !== undefined && (
                            <p className="mt-1">
                              Period: {formatDate(indicator.period.from, 'dayMonth')} –{' '}
                              {formatDate(indicator.period.to, 'dayMonthYear')}
                            </p>
                          )}
                        </details>
                        {indicator.link !== undefined && (
                          <Link
                            href={assistantHref(indicator.link.target)}
                            className="mt-auto inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                          >
                            {indicator.link.label}
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                          </Link>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <ExplainButton
            input={{ subject: 'financial_health', currency: data.currency }}
            aiAvailable={aiAvailable}
          />
          <MethodologyDisclosure methodology={data.methodology} />
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </>
      )}
    </section>
  );
}

function RecommendationCard({
  item,
  aiAvailable,
  onChanged,
  onOpenBudget,
}: {
  item: FinancialRecommendationDto;
  aiAvailable: boolean;
  onChanged: () => void;
  onOpenBudget: ((item: FinancialRecommendationDto) => void) | undefined;
}): ReactNode {
  const priority = PRIORITY_PRESENTATION[item.priority];
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const mark = async (action: 'dismiss' | 'review'): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      await markRecommendation(item.key, action);
      onChanged();
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={priority.tone}>{priority.label}</StatusBadge>
          {item.state === 'reviewed' && (
            <StatusBadge tone="neutral" showIcon={false}>
              Reviewed
            </StatusBadge>
          )}
        </div>
        <h3 className="font-medium">{item.title}</h3>
        <div className="flex flex-col gap-1 text-sm">
          <p>
            <span className="font-medium">What the records show: </span>
            <span className="text-muted-foreground">{item.observation}</span>
          </p>
          <p>
            <span className="font-medium">You could consider: </span>
            <span className="text-muted-foreground">{item.suggestion}</span>
          </p>
        </div>
        {item.metrics.length > 0 && (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {item.metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg bg-muted/50 px-3 py-2">
                <dt className="text-xs text-muted-foreground">{metric.label}</dt>
                <dd className="flex flex-wrap items-baseline gap-1">
                  {metric.amountMinor !== undefined && (
                    <FinancialAmount
                      amountMinor={metric.amountMinor}
                      currency={item.currency}
                      size="sm"
                    />
                  )}
                  {metric.text !== undefined && <span className="text-sm">{metric.text}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">{item.reevaluation}</p>
        <ExplainButton
          input={{ subject: 'recommendation', key: item.key, currency: item.currency }}
          aiAvailable={aiAvailable}
        />
        {failure !== undefined && <p className="text-sm text-expense">{failure}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {item.budgetPrefill !== undefined && onOpenBudget !== undefined && (
            <Button
              type="button"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => {
                onOpenBudget(item);
              }}
            >
              Open the budget form
            </Button>
          )}
          {item.links.slice(0, 2).map((link) => (
            <Button key={link.label} asChild variant="outline" size="sm" className="h-11 sm:h-8">
              <Link href={assistantHref(link.target)}>
                {link.label}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ))}
          {item.state === 'new' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 sm:h-8"
              disabled={busy}
              onClick={() => void mark('review')}
            >
              <Check aria-hidden="true" /> Mark as reviewed
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            disabled={busy}
            aria-label={`Dismiss: ${item.title}`}
            onClick={() => void mark('dismiss')}
          >
            <EyeOff aria-hidden="true" /> Dismiss
          </Button>
        </div>
      </Card>
    </li>
  );
}

export function RecommendationsSection({
  currency,
  timeZone,
  aiAvailable,
  onOpenBudget,
}: {
  currency: CurrencyCode | undefined;
  timeZone: string;
  aiAvailable: boolean;
  onOpenBudget?: (item: FinancialRecommendationDto) => void;
}): ReactNode {
  const list = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<RecommendationListDto> => getRecommendations(currency, signal),
      [currency],
    ),
  );
  const data = list.state.status === 'success' ? list.state.data : undefined;
  return (
    <section aria-labelledby="recommendations-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="recommendations-heading"
        title="Recommendations"
        description="Things worth looking at, each with the figures behind it. Suggestions only — nothing changes unless you change it."
      />
      {list.state.status === 'loading' && <ListSkeleton rows={2} />}
      {list.state.status === 'error' && (
        <ErrorState
          title="Recommendations could not be loaded"
          description={describeRequestError(list.state.error)}
          onRetry={list.reload}
        />
      )}
      {data !== undefined && (
        <>
          {data.items.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              headingLevel="h3"
              title={
                data.sufficiency.level === 'insufficient'
                  ? 'Not enough history yet'
                  : 'Nothing to recommend right now'
              }
              description={
                data.sufficiency.level === 'insufficient'
                  ? 'Recommendations need at least two completed months of recorded spending.'
                  : 'Your budgets, goals, and upcoming payments look as expected by CalmCash’s rules.'
              }
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {data.items.map((item) => (
                <RecommendationCard
                  key={item.key}
                  item={item}
                  aiAvailable={aiAvailable}
                  onChanged={list.refresh}
                  onOpenBudget={onOpenBudget}
                />
              ))}
            </ul>
          )}
          {data.dismissedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {data.dismissedCount.toString()} dismissed{' '}
              {data.dismissedCount === 1 ? 'recommendation is' : 'recommendations are'} hidden until
              the subject changes.
            </p>
          )}
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </>
      )}
    </section>
  );
}
