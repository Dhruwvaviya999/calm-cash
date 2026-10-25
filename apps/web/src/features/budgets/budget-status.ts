import type { ProgressTone } from '@/components/finance/progress-meter';
import type { StatusTone } from '@/components/feedback/status-badge';

export type BudgetStatus = 'on-track' | 'near-limit' | 'over-budget';

export interface BudgetStatusPresentation {
  status: BudgetStatus;
  label: string;
  badgeTone: StatusTone;
  meterTone: ProgressTone;
}

/** Share of the limit (in percent) from which a budget counts as close to its limit. */
export const NEAR_LIMIT_PERCENT = 85;

/** Maps the percentage of a budget already used to a status with matching label and tones. */
export function getBudgetStatus(percentUsed: number): BudgetStatusPresentation {
  if (percentUsed > 100) {
    return {
      status: 'over-budget',
      label: 'Over budget',
      badgeTone: 'negative',
      meterTone: 'negative',
    };
  }
  if (percentUsed >= NEAR_LIMIT_PERCENT) {
    return {
      status: 'near-limit',
      label: 'Close to limit',
      badgeTone: 'warning',
      meterTone: 'warning',
    };
  }
  return { status: 'on-track', label: 'On track', badgeTone: 'positive', meterTone: 'positive' };
}
