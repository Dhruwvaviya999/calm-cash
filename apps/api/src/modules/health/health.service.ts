import type { HealthCheckDto, ReadinessCheckDto } from '@calmcash/shared';

import type { DatabaseHealthCheck } from '../../lib/database';

export type HealthDependency = 'database';

export type ReadinessResult =
  | { ready: true; report: ReadinessCheckDto }
  | { ready: false; unavailable: readonly HealthDependency[] };

export interface HealthService {
  getLiveness: () => HealthCheckDto;
  getReadiness: () => Promise<ReadinessResult>;
}

export interface HealthServiceDependencies {
  checkDatabase: DatabaseHealthCheck;
  /** Injectable for deterministic tests. */
  now?: () => Date;
  uptimeSeconds?: () => number;
}

export function createHealthService({
  checkDatabase,
  now = () => new Date(),
  uptimeSeconds = () => process.uptime(),
}: HealthServiceDependencies): HealthService {
  return {
    getLiveness: () => ({
      status: 'ok',
      uptimeSeconds: Math.floor(uptimeSeconds()),
      timestamp: now().toISOString(),
    }),

    getReadiness: async () => {
      const databaseUp = await checkDatabase();
      if (!databaseUp) {
        return { ready: false, unavailable: ['database'] };
      }
      return {
        ready: true,
        report: { status: 'ok', checks: { database: 'up' }, timestamp: now().toISOString() },
      };
    },
  };
}
