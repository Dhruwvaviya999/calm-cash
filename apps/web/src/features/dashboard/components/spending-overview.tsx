import type { CurrencyCode, MinorUnitsString } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { CategoryIcon } from '@/components/finance/category-icon';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { SectionHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { formatMoney, percentOf } from '@/lib/format';
import { CATEGORY_BAR_CLASSES, getCategoryVisual } from '@/lib/finance-presentation';
import { cn } from '@/lib/utils';

import type { CategoryAmount } from '../types';

/** Categories shown on phones; the rest appear from the `sm` breakpoint. */
const MOBILE_VISIBLE = 4;

export interface SpendingOverviewProps {
  categories: readonly CategoryAmount[];
  totalMinor: MinorUnitsString;
  currency: CurrencyCode;
  periodLabel: string;
  className?: string;
}

/** Where the money went: categories ranked by spend, with share-of-total bars (CSS only). */
export function SpendingOverview({
  categories,
  totalMinor,
  currency,
  periodLabel,
  className,
}: SpendingOverviewProps): ReactNode {
  return (
    <Card className={cn('p-5 sm:p-6', className)}>
      <section aria-labelledby="spending-heading" className="flex flex-col gap-5">
        <SectionHeader
          id="spending-heading"
          title="Where your money went"
          description={`${formatMoney(totalMinor, currency)} spent in ${periodLabel}`}
        />
        <ul className="flex flex-col gap-4">
          {categories.map(({ category, amountMinor }, index) => {
            const share = percentOf(amountMinor, totalMinor);
            const { tone } = getCategoryVisual(category);
            return (
              <li
                key={category.id}
                className={cn(
                  'flex items-center gap-3',
                  index >= MOBILE_VISIBLE && 'max-sm:hidden',
                )}
              >
                <CategoryIcon category={category} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{category.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      <FinancialAmount
                        amountMinor={amountMinor}
                        currency={currency}
                        size="sm"
                        className="text-foreground"
                      />
                      <span className="ml-2 inline-block w-9 text-right tabular-nums">
                        {share}%
                      </span>
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', CATEGORY_BAR_CLASSES[tone])}
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
