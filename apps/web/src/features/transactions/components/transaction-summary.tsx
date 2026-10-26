import { CURRENCIES, type TransactionSummaryDto } from '@calmcash/shared';
import { ArrowDownLeft, ArrowUpRight, Scale, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { FinancialAmount, type AmountDirection } from '@/components/finance/financial-amount';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface TransactionSummaryProps {
  summary: TransactionSummaryDto;
  /** Describes what the totals cover, e.g. "1 Oct – 26 Oct 2026, matching your filters". */
  scope: string;
}

function Figure({
  label,
  icon: Icon,
  tone,
  amountMinor,
  currency,
  direction,
  footnote,
}: {
  label: string;
  icon: LucideIcon;
  tone: string;
  amountMinor: string;
  currency: TransactionSummaryDto['currencies'][number]['currency'];
  direction: AmountDirection;
  footnote: string;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 min-[560px]:flex-col min-[560px]:items-start min-[560px]:py-0">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', tone)}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        {label}
      </dt>
      <dd className="flex flex-col items-end min-[560px]:items-start">
        <FinancialAmount amountMinor={amountMinor} currency={currency} direction={direction} />
        <span className="text-xs text-muted-foreground">{footnote}</span>
      </dd>
    </div>
  );
}

/**
 * Money in, money out, and the difference for exactly the transactions the list shows, per
 * currency (never converted or added across currencies). Transfers and balance adjustments are
 * neither income nor spending, and voided transactions never count. Kept compact: the history is
 * the main content.
 */
export function TransactionSummary({ summary, scope }: TransactionSummaryProps): ReactNode {
  if (summary.currencies.length === 0) {
    return null;
  }
  const multiple = summary.currencies.length > 1;
  return (
    <section aria-labelledby="transactions-summary-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="transactions-summary-heading" className="text-base font-semibold tracking-tight">
          Money in and out
        </h2>
        <p className="text-sm text-muted-foreground">
          {scope}. Transfers between your accounts and balance adjustments are not included.
        </p>
      </div>
      <div className={cn('grid gap-3', multiple && 'lg:grid-cols-2')}>
        {summary.currencies.map((entry) => (
          <Card key={entry.currency} className="gap-0 px-4 py-2 min-[560px]:py-4 sm:px-5">
            {multiple && (
              <p className="pt-1.5 pb-1 text-sm font-medium min-[560px]:pt-0 min-[560px]:pb-3">
                {CURRENCIES[entry.currency].name} ({entry.currency})
              </p>
            )}
            <dl className="divide-y min-[560px]:grid min-[560px]:grid-cols-3 min-[560px]:gap-4 min-[560px]:divide-y-0">
              <Figure
                label="Money in"
                icon={ArrowDownLeft}
                tone="bg-income/10 text-income"
                amountMinor={entry.incomeMinor}
                currency={entry.currency}
                direction="credit"
                footnote={`${String(entry.incomeCount)} income ${entry.incomeCount === 1 ? 'entry' : 'entries'}`}
              />
              <Figure
                label="Money out"
                icon={ArrowUpRight}
                tone="bg-expense/10 text-expense"
                amountMinor={entry.expenseMinor}
                currency={entry.currency}
                direction="debit"
                footnote={`${String(entry.expenseCount)} ${entry.expenseCount === 1 ? 'expense' : 'expenses'}`}
              />
              <Figure
                label="Net cash flow"
                icon={Scale}
                tone="bg-muted text-muted-foreground"
                amountMinor={entry.netMinor}
                currency={entry.currency}
                direction="balance"
                footnote={
                  entry.netMinor.startsWith('-') ? 'More went out than came in' : 'In minus out'
                }
              />
            </dl>
          </Card>
        ))}
      </div>
    </section>
  );
}
