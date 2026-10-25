import { PiggyBank } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { PlannedCapabilities } from '@/components/feedback/planned-capabilities';
import { StatusBadge } from '@/components/feedback/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { BudgetProgress } from '@/features/budgets';
import { sampleBudgets } from '@/fixtures/sample-finances';

export const metadata: Metadata = { title: 'Budgets' };

export default function BudgetsPage(): ReactNode {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={<StatusBadge tone="upcoming">Coming soon</StatusBadge>}
        title="Budgets"
        description="Gentle spending limits that help you stay on track without the stress."
      />

      <EmptyState
        icon={PiggyBank}
        title="Plan your spending with budgets"
        description="Set a monthly limit for any category and CalmCash will show, at a glance, how much is left and when you are getting close."
      >
        <PlannedCapabilities
          label="Planned budget features"
          items={[
            'Weekly, monthly, yearly, or custom budget periods',
            'Budgets for one category or for all spending',
            'Early, calm warnings before you reach a limit',
          ]}
        />
      </EmptyState>

      <section aria-labelledby="budgets-preview-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="budgets-preview-heading"
          title="Preview: how budgets will look"
          description="Sample budgets for October 2026, to show the layout."
          action={<StatusBadge tone="info">Sample data</StatusBadge>}
        />
        <ul className="grid gap-4 md:grid-cols-2">
          {sampleBudgets.map((entry) => (
            <li key={entry.budget.id}>
              <Card className="p-5">
                <BudgetProgress {...entry} />
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
