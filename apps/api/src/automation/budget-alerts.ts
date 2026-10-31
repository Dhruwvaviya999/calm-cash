import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  startOfDayInTimeZone,
  type BudgetWithProgressDto,
} from '@calmcash/shared';

import type { AutomationDomain, UserContext } from './domain';
import { budgetAlertText } from './notification-text';
import type { NotificationWriter } from './notification-writer';

// Budget alerts from the Phase 7 budget engine. Progress comes from `BudgetsService.list` — the
// ledger-backed spending of each active budget in its own currency, period, time zone, and
// category roll-up, with transfers, adjustments, and voided rows excluded — so an alert can never
// disagree with the budget page. Thresholds are the budget's own `alert_thresholds_bp`; reaching
// the limit (100 %) always alerts.
//
// Identity: `budget:<budget>:<period start>:<limit>:<level>`. Each level alerts at most once per
// budget, period, and limit. A level already notified — or any higher one — covers it, so
// spending that drops below a threshold (a void) and rises again does not alert twice, and a
// single large expense that jumps past several levels creates one alert, for the highest. A new
// period, a changed limit, or a new threshold is a new identity and can alert again.

/** The limit itself, as an alert level. */
export const LIMIT_LEVEL_BP = 10_000;

const BASIS_POINTS = 10_000n;

/** Longest an alert e-mail may wait to be sent (within the budget period). */
const BUDGET_EMAIL_MAX_DELAY_MS = 2 * 24 * 60 * 60 * 1000;

export function budgetAlertKey(
  budgetId: string,
  periodFrom: string,
  limitMinor: string,
  levelBp: number,
): string {
  return `budget:${budgetId}:${periodFrom}:${limitMinor}:${levelBp.toString()}`;
}

/** A budget's alert levels, ascending: its thresholds below 100 %, then the limit. */
export function alertLevels(thresholdsBp: readonly number[]): number[] {
  const below = thresholdsBp.filter((value) => value > 0 && value < LIMIT_LEVEL_BP);
  return [...new Set([...below, LIMIT_LEVEL_BP])].sort((a, b) => a - b);
}

/** The highest level spending has reached, by exact comparison (79.996 % has not reached 80 %). */
export function reachedLevel(
  levelsBp: readonly number[],
  spentMinor: bigint,
  limitMinor: bigint,
): number | undefined {
  if (limitMinor <= 0n) return undefined;
  return [...levelsBp]
    .reverse()
    .find((level) => spentMinor * BASIS_POINTS >= BigInt(level) * limitMinor);
}

export interface BudgetAlertPlan {
  item: BudgetWithProgressDto;
  levelBp: number;
  dedupeKey: string;
  /** This level's identity and every higher one: any of them existing means "already told". */
  coveringKeys: string[];
}

/** The alert a budget's current progress calls for, before checking what was already sent. */
export function planBudgetAlert(item: BudgetWithProgressDto): BudgetAlertPlan | undefined {
  const { budget, progress } = item;
  if (budget.status !== 'active' || progress.timing !== 'current') {
    return undefined;
  }
  const levels = alertLevels(budget.alertThresholdsBp);
  const level = reachedLevel(levels, BigInt(progress.spentMinor), BigInt(progress.limitMinor));
  if (level === undefined) {
    return undefined;
  }
  const keyOf = (value: number): string =>
    budgetAlertKey(budget.id, progress.from, progress.limitMinor, value);
  return {
    item,
    levelBp: level,
    dedupeKey: keyOf(level),
    coveringKeys: levels.filter((value) => value >= level).map(keyOf),
  };
}

export interface BudgetEvaluationContext {
  domain: AutomationDomain;
  writer: NotificationWriter;
}

/** Re-checks every active budget of one user and creates the alerts that became due. */
export async function evaluateBudgetAlerts(
  { domain, writer }: BudgetEvaluationContext,
  user: UserContext,
  now: Date,
): Promise<number> {
  const channels = user.preferences.channels.budget_alerts;
  if (!channels.inApp && !channels.email) {
    return 0;
  }
  const today = calendarDateInTimeZone(now, user.caller.timeZone);
  const { budgets } = await domain.budgets.list(user.caller, { status: 'active', date: today });
  const plans = budgets.flatMap((item) => planBudgetAlert(item) ?? []);
  if (plans.length === 0) {
    return 0;
  }
  const existing = await writer.existingKeys(
    user.caller.userId,
    plans.flatMap((plan) => plan.coveringKeys),
  );

  let created = 0;
  for (const plan of plans) {
    if (plan.coveringKeys.some((key) => existing.has(key))) {
      continue;
    }
    const { budget, progress } = plan.item;
    const periodEnd = startOfDayInTimeZone(addDaysToIsoDate(progress.to, 1), user.caller.timeZone);
    const latest = new Date(now.getTime() + BUDGET_EMAIL_MAX_DELAY_MS);
    const outcome = await writer.write(
      {
        userId: user.caller.userId,
        type: plan.levelBp >= LIMIT_LEVEL_BP ? 'budget_limit_reached' : 'budget_approaching_limit',
        dedupeKey: plan.dedupeKey,
        ...budgetAlertText({
          name: budget.name,
          currency: budget.currency,
          limitMinor: BigInt(progress.limitMinor),
          spentMinor: BigInt(progress.spentMinor),
          from: progress.from,
          to: progress.to,
          thresholdBp: plan.levelBp,
        }),
        target: { kind: 'budget', budgetId: budget.id, periodFrom: progress.from },
        channels,
        emailExpiresAt: periodEnd < latest ? periodEnd : latest,
      },
      user.emailVerified,
      now,
    );
    if (outcome === 'created') created += 1;
  }
  return created;
}
