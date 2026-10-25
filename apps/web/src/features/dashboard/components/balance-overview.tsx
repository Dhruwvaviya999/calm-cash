import { parseMinorUnits, type CurrencyCode } from '@calmcash/shared';
import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { Card } from '@/components/ui/card';
import { formatMoney, percentOf } from '@/lib/format';
import { ACCOUNT_TYPE_PRESENTATION } from '@/lib/finance-presentation';
import { cn } from '@/lib/utils';

import type { AccountBalance, MonthlyAmount, MonthSummary } from '../types';

/** CSS-only trend sketch; Phase 6 replaces it with real charts. Readable as a plain list. */
function SavedTrend({
  trend,
  currency,
}: {
  trend: readonly MonthlyAmount[];
  currency: CurrencyCode;
}): ReactNode {
  const max = trend.reduce((largest, entry) => {
    const value = parseMinorUnits(entry.amountMinor);
    return value > largest ? value : largest;
  }, 0n);

  return (
    <ol aria-label="Amount saved per month" className="flex h-28 items-end gap-2 sm:gap-3">
      {trend.map((entry, index) => {
        const latest = index === trend.length - 1;
        return (
          <li
            key={entry.month}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
          >
            <span className="sr-only">
              {entry.month}: {formatMoney(entry.amountMinor, currency)}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'w-full max-w-8 rounded-md',
                latest ? 'bg-primary' : 'bg-primary/20 dark:bg-primary/25',
              )}
              style={{ height: `${Math.max(percentOf(entry.amountMinor, max), 6)}%` }}
            />
            <span
              aria-hidden="true"
              className={cn('text-2xs', latest ? 'font-semibold' : 'text-muted-foreground')}
            >
              {entry.month}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface BalanceOverviewProps {
  summary: MonthSummary;
  accounts: readonly AccountBalance[];
  currency: CurrencyCode;
}

/** Primary dashboard section: total balance, this period's savings, and balances per account. */
export function BalanceOverview({ summary, accounts, currency }: BalanceOverviewProps): ReactNode {
  return (
    <Card className="overflow-hidden">
      <section aria-labelledby="balance-heading">
        <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] md:items-end">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id="balance-heading" className="text-sm font-medium text-muted-foreground">
              Total balance
            </h2>
            <FinancialAmount
              amountMinor={summary.totalBalanceMinor}
              currency={currency}
              size="display"
            />
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-income/10 px-2 py-0.5 font-medium text-income">
                <TrendingUp aria-hidden="true" className="size-3.5" />
                <FinancialAmount
                  amountMinor={summary.savedMinor}
                  currency={currency}
                  direction="credit"
                  size="sm"
                />
              </span>
              saved in {summary.periodLabel}
            </p>
          </div>
          <SavedTrend trend={summary.savedTrend} currency={currency} />
        </div>

        {/* Secondary detail: hidden on phones, where the Accounts tab is one tap away. */}
        <div className="hidden border-t bg-muted/40 sm:block">
          <ul
            aria-label="Balances by account"
            className="grid grid-cols-2 divide-x divide-y lg:grid-cols-4 lg:divide-y-0"
          >
            {accounts.map(({ account, balanceMinor }) => {
              const Icon = ACCOUNT_TYPE_PRESENTATION[account.type].icon;
              return (
                <li key={account.id} className="flex min-w-0 items-center gap-3 px-5 py-4">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{account.name}</p>
                    <FinancialAmount
                      amountMinor={balanceMinor}
                      currency={account.currency}
                      size="sm"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="border-t px-5 py-3 sm:hidden">
          <Link
            href="/accounts"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View balances by account
          </Link>
        </div>
      </section>
    </Card>
  );
}
