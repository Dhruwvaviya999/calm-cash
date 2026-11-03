'use client';

import { CURRENCY_CODES, type BudgetPrefillDto, type CurrencyCode } from '@calmcash/shared';
import {
  CalendarRange,
  LayoutGrid,
  Lightbulb,
  PiggyBank,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { PageHeader } from '@/components/layout/page-header';
import { SectionTabs, type SectionTab } from '@/components/layout/section-tabs';
import { Button } from '@/components/ui/button';
import { describeAiProblem } from '@/features/ai/ai-presentation';
import { useAiStatus } from '@/features/ai/use-ai-status';
import { useSignedInSession } from '@/features/auth';
import {
  BudgetPrefillSheet,
  BudgetRecommendationsSection,
  CashFlowForecastSection,
  CategoryPredictionsSection,
  FinancialHealthSection,
  FinancialOverviewSection,
  GoalProjectionsSection,
  RecommendationsSection,
  SpendingPatternsSection,
} from '@/features/intelligence';

import { useInsightsSelection } from '../use-insights-selection';
import { RecurringCandidates } from './recurring-candidates';
import { ReportBuilder } from './report-builder';
import { SpendingInsights } from './spending-insights';
import { TidyUp } from './tidy-up';

const TABS = ['overview', 'forecast', 'spending', 'planning', 'more'] as const;
type InsightsTab = (typeof TABS)[number];

function readTab(value: string | null): InsightsTab {
  return TABS.find((tab) => tab === value) ?? 'overview';
}

function readCurrency(value: string | null): CurrencyCode | undefined {
  return CURRENCY_CODES.find((code) => code === value);
}

/**
 * The financial intelligence center: an overview with health indicators and recommendations,
 * forecasts and category predictions, spending trends and unusual activity, budget and goal
 * planning, and the tidy-up tools. Every figure is calculated by CalmCash from recorded
 * transactions and schedules; estimates are labelled as estimates, the assistant only explains,
 * and nothing changes until the person acts in the ordinary forms.
 */
export function InsightsPage(): ReactNode {
  const { user } = useSignedInSession();
  const params = useSearchParams();
  const tab = readTab(params.get('tab'));
  const currency = readCurrency(params.get('currency'));
  const { selection, query, setSelection } = useInsightsSelection();
  const status = useAiStatus();
  const aiAvailable = status.state.status === 'success' && status.state.data.available;
  const [currencies, setCurrencies] = useState<
    { list: CurrencyCode[]; shown: CurrencyCode } | undefined
  >();
  const [prefill, setPrefill] = useState<BudgetPrefillDto | undefined>();
  const [saved, setSaved] = useState<string | undefined>();
  const onCurrencies = useCallback((list: CurrencyCode[], shown: CurrencyCode) => {
    setCurrencies({ list, shown });
  }, []);

  const hrefFor = (
    next: InsightsTab,
    nextCurrency = currency,
  ): SectionTab<InsightsTab>['href'] => ({
    pathname: '/insights',
    query: { tab: next, ...(nextCurrency === undefined ? {} : { currency: nextCurrency }) },
  });
  const tabs: SectionTab<InsightsTab>[] = [
    { value: 'overview', label: 'Overview', icon: LayoutGrid, href: hrefFor('overview') },
    { value: 'forecast', label: 'Forecasts', icon: TrendingUp, href: hrefFor('forecast') },
    { value: 'spending', label: 'Spending', icon: Sparkles, href: hrefFor('spending') },
    { value: 'planning', label: 'Budgets & goals', icon: PiggyBank, href: hrefFor('planning') },
    { value: 'more', label: 'Tidy up & reports', icon: Lightbulb, href: hrefFor('more') },
  ];
  const timeZone = user.timezone;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Insights"
        description="Where you stand, where you could be heading, and what may be worth a look — worked out from your own records."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-11 sm:h-9">
              <Link href="/scenarios">
                <CalendarRange aria-hidden="true" /> What-if scenarios
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 sm:h-9">
              <Link href="/assistant">Ask the assistant</Link>
            </Button>
          </div>
        }
      />

      {status.state.status === 'success' && !status.state.data.available && (
        <p className="-mt-4 text-sm text-muted-foreground">
          {describeAiProblem(status.state.data.problem ?? 'unreachable', status.state.data.model)}{' '}
          Every figure, forecast, and recommendation still works; only the plain-word explanations
          are unavailable.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionTabs label="Insights sections" tabs={tabs} current={tab} className="sm:flex-1" />
        {currencies !== undefined && currencies.list.length > 1 && (
          <CurrencySwitch
            currencies={currencies.list}
            value={currency ?? currencies.shown}
            tab={tab}
            hrefFor={hrefFor}
          />
        )}
      </div>

      {saved !== undefined && (
        <FormMessage tone="success" title="Saved">
          {saved}
        </FormMessage>
      )}

      {tab === 'overview' && (
        <>
          <FinancialOverviewSection currency={currency} onCurrencies={onCurrencies} />
          <RecommendationsSection
            currency={currency}
            timeZone={timeZone}
            aiAvailable={aiAvailable}
            onOpenBudget={(item) => {
              setPrefill(item.budgetPrefill);
            }}
          />
          <FinancialHealthSection
            currency={currency}
            timeZone={timeZone}
            aiAvailable={aiAvailable}
          />
        </>
      )}
      {tab === 'forecast' && (
        <>
          <CashFlowForecastSection
            currency={currency}
            timeZone={timeZone}
            aiAvailable={aiAvailable}
          />
          <CategoryPredictionsSection
            currency={currency}
            timeZone={timeZone}
            aiAvailable={aiAvailable}
          />
        </>
      )}
      {tab === 'spending' && (
        <>
          <SpendingPatternsSection currency={currency} timeZone={timeZone} />
          <SpendingInsights
            selection={selection}
            query={query}
            timeZone={timeZone}
            aiAvailable={aiAvailable}
            onSelectionChange={setSelection}
          />
        </>
      )}
      {tab === 'planning' && (
        <>
          <BudgetRecommendationsSection
            currency={currency}
            timeZone={timeZone}
            aiAvailable={aiAvailable}
          />
          <GoalProjectionsSection timeZone={timeZone} aiAvailable={aiAvailable} />
        </>
      )}
      {tab === 'more' && (
        <>
          <RecurringCandidates />
          <TidyUp />
          <ReportBuilder selection={selection} timeZone={timeZone} />
        </>
      )}

      <BudgetPrefillSheet
        prefill={prefill}
        timeZone={timeZone}
        onClose={() => {
          setPrefill(undefined);
        }}
        onSaved={(item) => {
          setPrefill(undefined);
          setSaved(
            `${item.budget.name} was saved. Recommendations update the next time they load.`,
          );
        }}
      />
    </div>
  );
}

function CurrencySwitch({
  currencies,
  value,
  tab,
  hrefFor,
}: {
  currencies: readonly CurrencyCode[];
  value: CurrencyCode;
  tab: InsightsTab;
  hrefFor: (tab: InsightsTab, currency?: CurrencyCode) => SectionTab<InsightsTab>['href'];
}): ReactNode {
  return (
    <nav aria-label="Currency">
      <ul className="flex flex-wrap gap-1">
        {currencies.map((code) => (
          <li key={code}>
            <Button
              asChild
              size="sm"
              variant={code === value ? 'default' : 'outline'}
              className="h-11 sm:h-8"
            >
              <Link
                href={hrefFor(tab, code)}
                scroll={false}
                aria-current={code === value ? 'true' : undefined}
              >
                {code}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
