'use client';

import { CalendarClock, Goal, MonitorPlay, PiggyBank } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { SectionTabs, type SectionTab } from '@/components/layout/section-tabs';
import { BudgetsOverview } from '@/features/budgets';
import { GoalsOverview } from '@/features/goals';
import { RecurringOverview } from '@/features/recurring';
import { SubscriptionsOverview } from '@/features/subscriptions';

export const PLANNING_SECTIONS = ['budgets', 'recurring', 'subscriptions', 'goals'] as const;

export type PlanningSection = (typeof PLANNING_SECTIONS)[number];

function sectionTab(
  value: PlanningSection,
  label: string,
  icon: SectionTab<PlanningSection>['icon'],
): SectionTab<PlanningSection> {
  return {
    value,
    label,
    icon,
    href: value === 'budgets' ? '/budgets' : { pathname: '/budgets', query: { section: value } },
  };
}

const TABS: readonly SectionTab<PlanningSection>[] = [
  sectionTab('budgets', 'Budgets', PiggyBank),
  sectionTab('recurring', 'Bills & recurring', CalendarClock),
  sectionTab('subscriptions', 'Subscriptions', MonitorPlay),
  sectionTab('goals', 'Goals', Goal),
];

export function parseSection(value: string | null): PlanningSection {
  return PLANNING_SECTIONS.find((section) => section === value) ?? 'budgets';
}

/**
 * Planning: budgets, recurring bills and income, subscriptions, and savings goals, each in its own
 * section with its own URL (`?section=`). Sections are independent features sharing one header.
 */
export function PlanningPage(): ReactNode {
  const section = parseSection(useSearchParams().get('section'));
  return (
    <>
      <PageHeader
        title="Budgets & planning"
        description="Limits for your spending, the bills you expect, and what you are saving for."
      />
      <SectionTabs label="Planning sections" tabs={TABS} current={section} />
      {section === 'budgets' && <BudgetsOverview />}
      {section === 'recurring' && <RecurringOverview />}
      {section === 'subscriptions' && <SubscriptionsOverview />}
      {section === 'goals' && <GoalsOverview />}
    </>
  );
}
