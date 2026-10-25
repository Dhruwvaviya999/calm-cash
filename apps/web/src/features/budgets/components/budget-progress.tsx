import type { BudgetDto, CategoryDto, MinorUnitsString } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { CategoryIcon } from '@/components/finance/category-icon';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { ProgressMeter } from '@/components/finance/progress-meter';
import { formatMoney, percentOf, subtractMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

import { getBudgetStatus } from '../budget-status';

export interface BudgetProgressProps {
  budget: BudgetDto;
  category?: CategoryDto | undefined;
  /** Amount spent so far in the current period. */
  spentMinor: MinorUnitsString;
}

/** One budget: name, status, a progress meter, and how much is left (or how much over). */
export function BudgetProgress({ budget, category, spentMinor }: BudgetProgressProps): ReactNode {
  const percent = percentOf(spentMinor, budget.limitMinor);
  const status = getBudgetStatus(percent);
  const remaining = subtractMinorUnits(budget.limitMinor, spentMinor);
  const overspent = remaining < 0n;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CategoryIcon category={category} size="sm" />
        <p className="min-w-0 flex-1 truncate font-medium">{budget.name}</p>
        <StatusBadge tone={status.badgeTone}>{status.label}</StatusBadge>
      </div>
      <ProgressMeter
        percent={percent}
        tone={status.meterTone}
        label={`${budget.name} budget used`}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <p className="whitespace-nowrap text-muted-foreground">
          <FinancialAmount
            amountMinor={spentMinor}
            currency={budget.currency}
            size="sm"
            className="text-foreground"
          />{' '}
          of {formatMoney(budget.limitMinor, budget.currency)}
        </p>
        <p
          className={cn(
            'whitespace-nowrap',
            overspent ? 'font-medium text-expense' : 'text-muted-foreground',
          )}
        >
          {overspent
            ? `${formatMoney(-remaining, budget.currency)} over`
            : `${formatMoney(remaining, budget.currency)} left`}
        </p>
      </div>
    </div>
  );
}
