import type { CurrencyCode } from '@calmcash/shared';
import { ArrowDownLeft, ArrowUpRight, PiggyBank } from 'lucide-react';
import type { ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { StatCard } from '@/components/finance/stat-card';
import { percentOf } from '@/lib/format';

import type { MonthSummary } from '../types';

/** Money in, money out, and what was kept, for the selected period. */
export function SummaryStats({
  summary,
  currency,
}: {
  summary: MonthSummary;
  currency: CurrencyCode;
}): ReactNode {
  return (
    <section
      aria-label={`Summary for ${summary.periodLabel}`}
      className="grid grid-cols-1 gap-3 min-[22.5rem]:grid-cols-2 sm:gap-4 md:grid-cols-3"
    >
      <StatCard
        label="Money in"
        icon={ArrowDownLeft}
        tone="income"
        value={
          <FinancialAmount
            amountMinor={summary.incomeMinor}
            currency={currency}
            direction="credit"
            size="lg"
          />
        }
        footnote={summary.periodLabel}
      />
      <StatCard
        label="Money out"
        icon={ArrowUpRight}
        tone="expense"
        value={
          <FinancialAmount
            amountMinor={summary.spendingMinor}
            currency={currency}
            direction="debit"
            size="lg"
          />
        }
        footnote={summary.periodLabel}
      />
      <StatCard
        label="Saved"
        icon={PiggyBank}
        tone="savings"
        className="min-[22.5rem]:col-span-2 md:col-span-1"
        value={<FinancialAmount amountMinor={summary.savedMinor} currency={currency} size="lg" />}
        footnote={`${percentOf(summary.savedMinor, summary.incomeMinor)}% of what came in`}
      />
    </section>
  );
}
