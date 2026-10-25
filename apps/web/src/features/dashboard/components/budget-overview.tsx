import type { ReactNode } from 'react';

import { SectionHeader } from '@/components/layout/page-header';
import { SectionLink } from '@/components/layout/section-link';
import { Card } from '@/components/ui/card';
import { BudgetProgress, type BudgetProgressProps } from '@/features/budgets';
import { cn } from '@/lib/utils';

/** How this period's budgets are tracking. */
export function BudgetOverview({
  budgets,
  className,
}: {
  budgets: readonly BudgetProgressProps[];
  className?: string;
}): ReactNode {
  return (
    <Card className={cn('p-5 sm:p-6', className)}>
      <section aria-labelledby="budgets-heading" className="flex flex-col gap-5">
        <SectionHeader
          id="budgets-heading"
          title="Budgets"
          description="Spending against this month's limits"
          action={<SectionLink href="/budgets">View all</SectionLink>}
        />
        <ul className="flex flex-col gap-5">
          {budgets.map((entry) => (
            <li key={entry.budget.id}>
              <BudgetProgress {...entry} />
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
