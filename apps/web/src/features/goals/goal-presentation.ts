import type { GoalProgressDto, SavingsGoalStatus } from '@calmcash/shared';

import type { StatusTone } from '@/components/feedback/status-badge';
import type { ProgressTone } from '@/components/finance/progress-meter';
import { formatBasisPoints } from '@/lib/format';

// How savings goals are presented. Progress is calculated by the API from the allocations the
// person logged; it is not an account balance and not the dashboard's savings rate.

export const GOAL_STATUS_PRESENTATION: Readonly<
  Record<SavingsGoalStatus, { label: string; tone: StatusTone }>
> = {
  active: { label: 'Saving', tone: 'upcoming' },
  paused: { label: 'Paused', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'positive' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export function goalMeter(progress: GoalProgressDto): { percent: number; tone: ProgressTone } {
  const percent =
    progress.percent.status === 'available'
      ? Number(BigInt(progress.percent.basisPoints)) / 100
      : 0;
  return { percent, tone: progress.reached ? 'positive' : 'neutral' };
}

export function describeGoalPercent(progress: GoalProgressDto): string {
  return progress.percent.status === 'available'
    ? formatBasisPoints(progress.percent.basisPoints)
    : '—';
}

/** "92 days left", "Target date passed 3 days ago". */
export function describeTiming(progress: GoalProgressDto): string | undefined {
  const days = progress.daysRemaining;
  if (days === undefined) return undefined;
  if (days === 0) return 'Target date is today';
  if (days > 0) return `${String(days)} ${days === 1 ? 'day' : 'days'} left`;
  return `Target date passed ${String(-days)} ${days === -1 ? 'day' : 'days'} ago`;
}
