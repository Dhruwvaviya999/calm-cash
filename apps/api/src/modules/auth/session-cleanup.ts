import type { SessionConfig } from '../../config/env';
import type { Logger } from '../../lib/logger';
import type { AuthRepository } from './auth.repository';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Ended sessions and used tokens are kept for a week before deletion, so recent sign-outs and
 * revocations remain inspectable when investigating a problem.
 */
export const CLEANUP_RETENTION_MS = 7 * DAY_MS;
export const CLEANUP_INTERVAL_MS = HOUR_MS;

export interface SessionCleanupOptions {
  repository: Pick<AuthRepository, 'deleteStaleRecords'>;
  session: Pick<SessionConfig, 'idleTimeoutMs'>;
  logger: Logger;
  now?: () => Date;
}

/**
 * Deletes sessions and tokens that can no longer be used. A session qualifies only when it is
 * already unusable — expired, revoked, or idle past the timeout — and has stayed so for the
 * retention period, so cleanup can never sign anyone out.
 */
export async function cleanUpStaleAuthRecords({
  repository,
  session,
  logger,
  now = () => new Date(),
}: SessionCleanupOptions): Promise<{ sessions: number; tokens: number }> {
  const at = now().getTime();
  const result = await repository.deleteStaleRecords({
    endedBefore: new Date(at - CLEANUP_RETENTION_MS),
    idleBefore: new Date(at - session.idleTimeoutMs - CLEANUP_RETENTION_MS),
    tokensEndedBefore: new Date(at - CLEANUP_RETENTION_MS),
  });
  if (result.sessions > 0 || result.tokens > 0) {
    logger.info(result, 'Deleted stale sessions and authentication tokens');
  }
  return result;
}

/** Runs the cleanup hourly (and once shortly after start). Returns a function that stops it. */
export function scheduleSessionCleanup(options: SessionCleanupOptions): () => void {
  const run = (): void => {
    cleanUpStaleAuthRecords(options).catch((error: unknown) => {
      options.logger.warn({ err: error }, 'Session cleanup failed; it will be retried');
    });
  };
  const initial = setTimeout(run, 60_000);
  const interval = setInterval(run, CLEANUP_INTERVAL_MS);
  // Never keep the process alive just for housekeeping.
  initial.unref();
  interval.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
