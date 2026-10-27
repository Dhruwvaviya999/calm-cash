'use client';

import {
  DASHBOARD_RECENT_LIMIT,
  instantToZonedDateTime,
  type DashboardCategoriesDto,
  type DashboardOverviewDto,
  type DashboardTrendsDto,
  type TransactionPageDto,
} from '@calmcash/shared';
import { ArrowLeftRight, Plus, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';

import { ChartSkeleton } from '@/components/charts/chart-parts';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource, type AsyncResource } from '@/hooks/use-async-resource';
import { describeRequestError } from '@/lib/form-errors';
import {
  getDashboardCategories,
  getDashboardOverview,
  getDashboardTrends,
} from '@/services/dashboard.service';
import { listTransactions } from '@/services/transactions.service';

import { selectionToQuery } from '../dashboard-selection';
import { useDashboardSelection } from '../use-dashboard-selection';
import { CASH_FLOW_CHART_HEIGHT, CashFlowChart } from './cash-flow-chart';
import { DashboardControls, PERIOD_LABELS } from './dashboard-controls';
import {
  describeRange,
  FinancialPosition,
  PeriodSummary,
  RecentActivity,
  SectionCard,
  SectionLinkArrow,
} from './dashboard-sections';
import { SpendingChart } from './spending-chart';

/** A response together with the query it answers, to tell when newer figures are on the way. */
interface Answer<T> {
  query: string;
  data: T;
}

function greeting(timeZone: string): string {
  const hour = Number(instantToZonedDateTime(new Date(), timeZone).time.slice(0, 2));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Each section loads on its own, so one failing request never hides the others. */
function SectionError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
}): ReactNode {
  return (
    <ErrorState
      headingLevel="h2"
      title={`${what} could not be loaded`}
      description={`${describeRequestError(error)} The rest of the dashboard still works.`}
      onRetry={onRetry}
      className="border-0 bg-transparent px-0 py-6 shadow-none"
    />
  );
}

function busy<T>(resource: AsyncResource<Answer<T>>, query: string): boolean {
  return resource.state.status === 'success' && resource.state.data.query !== query;
}

/**
 * The live dashboard: what the user holds and owes now, and their cash flow for a period —
 * income, spending, net, savings rate, a trend, and where the money went — plus recent activity.
 * Every figure comes from the API for the signed-in user; nothing here is sample data, and
 * nothing financial is calculated in the browser.
 */
export function DashboardPage(): ReactNode {
  const { user } = useSignedInSession();
  const { selection, setSelection } = useDashboardSelection();
  const query = selectionToQuery(selection);

  const overview = useAsyncResource(
    useCallback(
      async (signal: AbortSignal): Promise<Answer<DashboardOverviewDto>> => ({
        query,
        data: await getDashboardOverview(query, signal),
      }),
      [query],
    ),
  );
  const trends = useAsyncResource(
    useCallback(
      async (signal: AbortSignal): Promise<Answer<DashboardTrendsDto>> => ({
        query,
        data: await getDashboardTrends(query, signal),
      }),
      [query],
    ),
  );
  const categories = useAsyncResource(
    useCallback(
      async (signal: AbortSignal): Promise<Answer<DashboardCategoriesDto>> => ({
        query,
        data: await getDashboardCategories(query, signal),
      }),
      [query],
    ),
  );
  const recent = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<TransactionPageDto> =>
        listTransactions(`sort=newest&page=1&pageSize=${String(DASHBOARD_RECENT_LIMIT)}`, signal),
      [],
    ),
  );

  const loaded = overview.state.status === 'success' ? overview.state.data.data : undefined;
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  const noAccounts =
    loaded !== undefined && loaded.accounts.active + loaded.accounts.archived === 0;
  const noActivity = loaded !== undefined && !noAccounts && !loaded.hasTransactions;

  const header = (
    <PageHeader
      eyebrow={<p className="text-sm text-muted-foreground">{greeting(user.timezone)},</p>}
      title={firstName}
      description={
        loaded === undefined
          ? 'Your money at a glance.'
          : `${PERIOD_LABELS[loaded.period.period]}: ${describeRange(loaded.period)}${
              loaded.currencies.length > 1 ? ` · ${loaded.currency}` : ''
            }`
      }
      actions={
        <Button asChild variant="outline">
          <Link href="/transactions">
            <ArrowLeftRight aria-hidden="true" />
            Transactions
          </Link>
        </Button>
      }
    />
  );

  if (noAccounts) {
    return (
      <>
        {header}
        <EmptyState
          icon={WalletCards}
          title="Add your first account to get started"
          description="CalmCash builds this overview from your own accounts and transactions: what you hold, what you owe, and where your money goes. Start with the account you use most."
        >
          <Button asChild size="lg" className="h-11">
            <Link href="/accounts">
              <Plus aria-hidden="true" />
              Add an account
            </Link>
          </Button>
        </EmptyState>
      </>
    );
  }

  const position = (
    <SectionCard
      id="position-heading"
      title="Where you stand"
      description="Right now, across your active accounts. Not affected by the period."
      action={<SectionLinkArrow href="/accounts">Accounts</SectionLinkArrow>}
    >
      {overview.state.status === 'loading' ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading your balances…</span>
          <Skeleton aria-hidden="true" className="h-24 rounded-xl bg-muted" />
        </div>
      ) : overview.state.status === 'error' ? (
        <SectionError what="Your balances" error={overview.state.error} onRetry={overview.reload} />
      ) : (
        <FinancialPosition position={overview.state.data.data.position} />
      )}
    </SectionCard>
  );

  return (
    <>
      {header}

      <DashboardControls
        key={query}
        selection={selection}
        currency={loaded?.currency ?? selection.currency ?? user.preferredCurrency}
        currencies={loaded?.currencies ?? []}
        timeZone={user.timezone}
        onChange={setSelection}
      />

      {position}

      {noActivity ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Record a transaction to see your cash flow"
          description="The balances above are your opening balances. Income, spending, trends, and categories appear here as soon as you record your first transaction."
        >
          <Button asChild size="lg" className="h-11">
            <Link href={{ pathname: '/transactions', query: { new: '1' } }}>
              <Plus aria-hidden="true" />
              Add a transaction
            </Link>
          </Button>
        </EmptyState>
      ) : (
        <>
          <section aria-label="Cash flow for the period" aria-busy={busy(overview, query)}>
            {overview.state.status === 'loading' ? (
              <div
                aria-hidden="true"
                className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4"
              >
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-28 rounded-xl bg-muted" />
                ))}
              </div>
            ) : overview.state.status === 'error' ? null : (
              <div
                className={
                  busy(overview, query) ? 'opacity-60 transition-opacity' : 'transition-opacity'
                }
              >
                <PeriodSummary overview={overview.state.data.data} />
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
            <SectionCard
              id="cash-flow-heading"
              title="Money in and out"
              description={
                trends.state.status === 'success'
                  ? `${trends.state.data.data.currency}, per ${trends.state.data.data.granularity}`
                  : undefined
              }
              className="lg:col-span-3"
              busy={busy(trends, query)}
            >
              {trends.state.status === 'loading' ? (
                <ChartSkeleton
                  height={CASH_FLOW_CHART_HEIGHT}
                  label="Loading the cash-flow chart…"
                />
              ) : trends.state.status === 'error' ? (
                <SectionError
                  what="The cash-flow chart"
                  error={trends.state.error}
                  onRetry={trends.reload}
                />
              ) : (
                <CashFlowChart trends={trends.state.data.data} />
              )}
            </SectionCard>

            <SectionCard
              id="spending-heading"
              title="Where your money went"
              description={
                categories.state.status === 'success'
                  ? `${String(categories.state.data.data.expenseCount)} expenses in ${categories.state.data.data.currency}`
                  : undefined
              }
              className="lg:col-span-2"
              busy={busy(categories, query)}
            >
              {categories.state.status === 'loading' ? (
                <ChartSkeleton height={200} label="Loading spending by category…" />
              ) : categories.state.status === 'error' ? (
                <SectionError
                  what="Spending by category"
                  error={categories.state.error}
                  onRetry={categories.reload}
                />
              ) : (
                <SpendingChart categories={categories.state.data.data} />
              )}
            </SectionCard>
          </div>

          <SectionCard
            id="recent-heading"
            title="Recent activity"
            description="Your latest transactions in every currency."
            action={<SectionLinkArrow href="/transactions">View all</SectionLinkArrow>}
          >
            {recent.state.status === 'loading' ? (
              <div role="status" aria-live="polite">
                <span className="sr-only">Loading recent transactions…</span>
                <ListSkeleton rows={4} />
              </div>
            ) : recent.state.status === 'error' ? (
              <SectionError
                what="Recent activity"
                error={recent.state.error}
                onRetry={recent.reload}
              />
            ) : recent.state.data.items.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <RecentActivity items={recent.state.data.items} timeZone={user.timezone} />
            )}
          </SectionCard>
        </>
      )}
    </>
  );
}
