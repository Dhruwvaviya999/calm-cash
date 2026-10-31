import type { BudgetEvaluationPayload } from '@calmcash/shared';

import type { Prisma } from '../generated/prisma/client';

// Business events for the background worker, written inside the database transaction of the
// change that causes them: if the change commits, so does its event, and if it rolls back, the
// event disappears with it. Nothing is lost while the worker is stopped — events wait in
// `automation_jobs` until a worker claims them.

/** Key of a user's waiting budget re-check: at most one waits per user (see `coalesce_key`). */
export function budgetEvaluationCoalesceKey(userId: string): string {
  return `budget_evaluation:${userId}`;
}

/**
 * Records that a user's spending or budgets changed, so the worker re-checks their budgets from
 * the ledger. When a re-check is already waiting it absorbs this event (`ON CONFLICT DO NOTHING`);
 * one already running clears its key when claimed, so a change made during a run queues exactly
 * one more.
 */
export async function recordBudgetsChanged(
  db: Prisma.TransactionClient,
  userIds: Iterable<string>,
  at: Date,
): Promise<void> {
  const payload: BudgetEvaluationPayload = { v: 1 };
  const data = [...new Set(userIds)].map((userId) => ({
    kind: 'budget_evaluation',
    userId,
    coalesceKey: budgetEvaluationCoalesceKey(userId),
    payload,
    runAt: at,
    createdAt: at,
  }));
  if (data.length === 0) {
    return;
  }
  await db.automationJob.createMany({ data, skipDuplicates: true });
}
