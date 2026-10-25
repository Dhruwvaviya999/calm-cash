import { ArrowLeftRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PreviewNotice } from '@/components/feedback/preview-notice';
import { StatusBadge } from '@/components/feedback/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  BalanceOverview,
  BudgetOverview,
  RecentTransactions,
  SpendingOverview,
  SummaryStats,
} from '@/features/dashboard';
import {
  sampleAccountBalances,
  sampleBudgets,
  sampleMonthSummary,
  sampleSpendingByCategory,
  sampleTransactionItems,
} from '@/fixtures/sample-finances';

export const metadata: Metadata = { title: 'Dashboard' };

const RECENT_COUNT = 5;
const BUDGET_PREVIEW_COUNT = 3;

/**
 * Design prototype of the dashboard (Phase 2). Every figure comes from the sample fixtures and is
 * labelled as such; the real dashboard will receive the same props from the API.
 */
export default function DashboardPage(): ReactNode {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={<StatusBadge tone="info">Design preview</StatusBadge>}
        title="Welcome to CalmCash"
        description={`A calm overview of your money for ${sampleMonthSummary.periodLabel}.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/transactions">
              <ArrowLeftRight aria-hidden="true" />
              View transactions
            </Link>
          </Button>
        }
      />

      <PreviewNotice />

      <BalanceOverview
        summary={sampleMonthSummary}
        accounts={sampleAccountBalances}
        currency="INR"
      />
      <SummaryStats summary={sampleMonthSummary} currency="INR" />

      <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
        <RecentTransactions
          items={sampleTransactionItems.slice(0, RECENT_COUNT)}
          className="lg:col-span-3"
        />
        <div className="flex flex-col gap-6 lg:col-span-2">
          <BudgetOverview budgets={sampleBudgets.slice(0, BUDGET_PREVIEW_COUNT)} />
          <SpendingOverview
            categories={sampleSpendingByCategory}
            totalMinor={sampleMonthSummary.spendingMinor}
            currency="INR"
            periodLabel={sampleMonthSummary.periodLabel}
          />
        </div>
      </div>
    </PageContainer>
  );
}
