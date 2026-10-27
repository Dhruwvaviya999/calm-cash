import type { BudgetPeriodTotalsDto, BudgetSummaryDto, CurrencyCode } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { ProgressMeter } from '@/components/finance/progress-meter';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  BUDGET_STATUS_PRESENTATION,
  CURRENT_PERIOD_LABELS,
  describeRange,
  describeRatio,
  meterPercent,
} from '../budget-presentation';

function totalsTone(totals: BudgetPeriodTotalsDto): 'positive' | 'warning' | 'negative' {
  const remaining = BigInt(totals.remainingMinor);
  if (remaining < 0n) return 'negative';
  return meterPercent(totals.used) >= 80 ? 'warning' : 'positive';
}

/** One cadence's totals: budgeted, spent, left — without counting nested budgets twice. */
export function BudgetTotals({
  totals,
  currency,
}: {
  totals: BudgetPeriodTotalsDto;
  currency: CurrencyCode;
}): ReactNode {
  const remaining = BigInt(totals.remainingMinor);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium">{CURRENT_PERIOD_LABELS[totals.period]}</p>
        <p className="text-xs text-muted-foreground">{describeRange(totals)}</p>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Budgeted</dt>
          <dd>
            <FinancialAmount amountMinor={totals.limitMinor} currency={currency} size="md" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Spent</dt>
          <dd>
            <FinancialAmount amountMinor={totals.spentMinor} currency={currency} size="md" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{remaining < 0n ? 'Over' : 'Left'}</dt>
          <dd
            className={cn(
              'text-[0.9375rem] font-semibold tabular-nums',
              remaining < 0n && 'text-expense',
            )}
          >
            {formatMoney(remaining < 0n ? -remaining : remaining, currency)}
          </dd>
        </div>
      </dl>
      <ProgressMeter
        percent={meterPercent(totals.used)}
        tone={totalsTone(totals)}
        label={`${CURRENT_PERIOD_LABELS[totals.period]} budgets used`}
        valueText={`${describeRatio(totals.used)} used`}
      />
      <p className="text-xs text-muted-foreground">
        {totals.scope === 'overall'
          ? 'From your all-spending budget, which already includes every category.'
          : `${String(totals.budgetCount)} ${totals.budgetCount === 1 ? 'budget' : 'budgets'}; subcategory budgets inside a budgeted category are not counted twice.`}
      </p>
    </div>
  );
}

const COUNTED = ['over_budget', 'limit_reached', 'approaching_limit', 'on_track'] as const;

/** "1 over budget · 2 close to limit · 4 on track", in words, never colour alone. */
export function BudgetStatusCounts({ summary }: { summary: BudgetSummaryDto }): ReactNode {
  const entries = COUNTED.filter((status) => summary.statusCounts[status] > 0);
  if (entries.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Budgets by status">
      {entries.map((status) => (
        <li key={status} className="text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">
            {summary.statusCounts[status]}
          </span>{' '}
          {BUDGET_STATUS_PRESENTATION[status].label.toLowerCase()}
        </li>
      ))}
    </ul>
  );
}
