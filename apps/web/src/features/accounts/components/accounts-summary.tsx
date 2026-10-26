import { CURRENCIES, type AccountSummaryDto } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { Card } from '@/components/ui/card';

function Figure({
  label,
  amountMinor,
  currency,
  count,
  emptyText,
  tone,
}: {
  label: string;
  amountMinor: string;
  currency: AccountSummaryDto['currencies'][number]['currency'];
  count: number;
  emptyText: string;
  tone: 'held' | 'owed';
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col">
        {count === 0 ? (
          <span className="text-sm text-muted-foreground">{emptyText}</span>
        ) : (
          <>
            <FinancialAmount
              amountMinor={amountMinor}
              currency={currency}
              size="lg"
              {...(tone === 'owed' ? { className: 'text-expense' } : {})}
            />
            <span className="text-xs text-muted-foreground">
              {count === 1 ? '1 account' : `${count} accounts`}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * Totals of the user's active accounts, one row per currency. Money held and money owed are shown
 * side by side and never netted or converted, and the caption says exactly what is included.
 */
export function AccountsSummary({ summary }: { summary: AccountSummaryDto }): ReactNode {
  if (summary.currencies.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="accounts-summary-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="accounts-summary-heading" className="text-base font-semibold tracking-tight">
          Totals
        </h2>
        <p className="text-sm text-muted-foreground">
          From your active accounts in CalmCash. Each currency is shown separately and never
          converted.
        </p>
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {summary.currencies.map((entry) => (
          <li key={entry.currency}>
            <Card className="p-4 sm:p-5">
              <p className="mb-3 text-sm font-medium">
                {CURRENCIES[entry.currency].name} ({entry.currency})
              </p>
              <dl className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
                <Figure
                  label="Money held"
                  amountMinor={entry.assetsMinor}
                  currency={entry.currency}
                  count={entry.assetAccounts}
                  emptyText="No accounts that hold money"
                  tone="held"
                />
                <Figure
                  label="Amount owed"
                  amountMinor={entry.liabilitiesMinor}
                  currency={entry.currency}
                  count={entry.liabilityAccounts}
                  emptyText="No credit cards"
                  tone="owed"
                />
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
