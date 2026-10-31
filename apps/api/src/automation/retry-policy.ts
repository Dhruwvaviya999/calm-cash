// Bounded retries with increasing delays. Pure: callers pass the clock.

export interface RetryPolicy {
  /** Delay before the second attempt. */
  baseDelayMs: number;
  /** Upper bound of any single delay. */
  maxDelayMs: number;
}

const MINUTE_MS = 60_000;

/** Jobs (budget checks, reviews): 30 s, 2 min, 8 min, 32 min, then 1 h. */
export const JOB_RETRY_POLICY: RetryPolicy = { baseDelayMs: 30_000, maxDelayMs: 60 * MINUTE_MS };

/** E-mail: 1 min, 4 min, 16 min, 64 min, then 3 h — long enough to ride out a provider outage. */
export const DELIVERY_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: MINUTE_MS,
  maxDelayMs: 180 * MINUTE_MS,
};

/** Delay before the next attempt after `attempts` failed ones (attempts ≥ 1): base × 4^(n−1). */
export function retryDelayMs(policy: RetryPolicy, attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 4 ** exponent);
}

export type RetryDecision = { action: 'retry'; at: Date } | { action: 'give_up'; reason: string };

/**
 * After a failed attempt: retry later, unless attempts are exhausted or the next attempt would
 * only happen after the work stopped being useful (`expiresAt`).
 */
export function decideRetry(
  policy: RetryPolicy,
  {
    attempts,
    maxAttempts,
    expiresAt,
  }: { attempts: number; maxAttempts: number; expiresAt: Date | null },
  now: Date,
): RetryDecision {
  if (attempts >= maxAttempts) {
    return { action: 'give_up', reason: 'attempts_exhausted' };
  }
  const at = new Date(now.getTime() + retryDelayMs(policy, attempts));
  if (expiresAt !== null && at >= expiresAt) {
    return { action: 'give_up', reason: 'expired' };
  }
  return { action: 'retry', at };
}
