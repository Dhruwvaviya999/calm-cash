import { CalendarRange, Lightbulb, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { StatusBadge } from '@/components/feedback/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Insights' };

const PLANNED_INSIGHTS: readonly { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: 'Spending patterns',
    description: 'See which categories grow month over month, and where you are spending less.',
    icon: Lightbulb,
  },
  {
    title: 'Unusual payments',
    description: 'A gentle heads-up when a payment is much larger than usual for that merchant.',
    icon: TriangleAlert,
  },
  {
    title: 'Monthly summaries',
    description:
      'A short, plain-language recap of every month: what came in, what went out, and why.',
    icon: CalendarRange,
  },
];

export default function InsightsPage(): ReactNode {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={<StatusBadge tone="upcoming">Coming soon</StatusBadge>}
        title="Insights"
        description="Clear explanations of your spending, so you always know where your money went."
      />

      <EmptyState
        icon={Sparkles}
        title="Insights appear once you have some history"
        description="After a few weeks of recorded transactions, CalmCash will start highlighting patterns worth knowing about. No insights are generated yet."
      />

      <section aria-labelledby="planned-insights-heading" className="flex flex-col gap-4">
        <SectionHeader id="planned-insights-heading" title="What to expect" />
        <ul className="grid gap-4 md:grid-cols-3">
          {PLANNED_INSIGHTS.map(({ title, description, icon: Icon }) => (
            <li key={title}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
