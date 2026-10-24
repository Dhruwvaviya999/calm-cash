import type { IsoDateTimeString } from '@calmcash/shared';

import { ApiClientError } from '@/lib/api-client';
import { getLiveness, getReadiness } from '@/services/health.service';

export type DatabaseStatus = 'connected' | 'unavailable';

export interface SystemStatus {
  api: 'online';
  database: DatabaseStatus;
  checkedAt: IsoDateTimeString;
}

/**
 * Combines liveness and readiness into one view model. Rejects when the API itself is
 * unreachable; a reachable API with an unavailable database resolves with `database: 'unavailable'`.
 */
export async function loadSystemStatus(signal: AbortSignal): Promise<SystemStatus> {
  const liveness = await getLiveness(signal);

  let database: DatabaseStatus = 'connected';
  try {
    await getReadiness(signal);
  } catch (error: unknown) {
    if (!(error instanceof ApiClientError && error.code === 'SERVICE_UNAVAILABLE')) {
      throw error;
    }
    database = 'unavailable';
  }

  return { api: 'online', database, checkedAt: liveness.timestamp };
}
