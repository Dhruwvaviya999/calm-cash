import type { BudgetWithProgressDto } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { CategoryIcon } from '@/components/finance/category-icon';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { ProgressMeter } from '@/components/finance/progress-meter';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

import { BUDGET_STATUS_PRESENTATION, describeRatio, meterPercent } from '../budget-presentation';

export interface BudgetProgressProps {
  item: BudgetWithProgressDto;
  /** Heading level of the budget name inside its card. */
  headingLevel?: 'h3' | 'h4';
}

/**
 * One budget's figures for its period, exactly as the API calculated them: spent of the limit,
 * how much is left (or how far over), and the share used — never capped at 100 %.
 */
export function BudgetProgress({
  item,
  headingLevel: Heading = 'h3',
}: BudgetProgressProps): ReactNode {
  const { budget, progress, category } = item;
  const status = BUDGET_STATUS_PRESENTATION[progress.status];
  const remaining = BigInt(progress.remainingMinor);
  const overspent = remaining < 0n;
  const used = describeRatio(progress.used);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start gap-3">
        <CategoryIcon category={category} size="sm" />
        <div className="min-w-0 flex-1">
          <Heading className="truncate font-medium">{budget.name}</Heading>
          <p className="truncate text-xs text-muted-foreground">
            {category === undefined
              ? 'All spending'
              : category.parentName === undefined
                ? category.name
                : `${category.parentName} › ${category.name}`}
            {category?.status === 'archived' ? ' (archived category)' : ''}
          </p>
        </div>
        <StatusBadge tone={status.badgeTone} className="shrink-0">
          {status.label}
        </StatusBadge>
      </div>
      <ProgressMeter
        percent={meterPercent(progress.used)}
        tone={status.meterTone}
        label={`${budget.name} budget used`}
        valueText={`${used} of the limit used`}
        marks={budget.alertThresholdsBp.map((value) => value / 100)}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <p className="text-muted-foreground">
          <FinancialAmount
            amountMinor={progress.spentMinor}
            currency={budget.currency}
            size="sm"
            className="text-foreground"
          />{' '}
          of {formatMoney(progress.limitMinor, budget.currency)}
          <span className="whitespace-nowrap"> · {used}</span>
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
      {progress.reachedThresholdBp !== undefined && progress.status === 'approaching_limit' && (
        <p className="text-xs text-warning-text">
          Past your {String(progress.reachedThresholdBp / 100)}% alert.
        </p>
      )}
    </div>
  );
}
