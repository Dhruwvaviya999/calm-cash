import { Router } from 'express';

import type { DatabaseHealthCheck } from '../../lib/database';
import { createHealthController } from './health.controller';
import { createHealthService } from './health.service';
import { requireOperationsToken, type OperationsStatusReader } from './operations-status';

export interface HealthModuleDependencies {
  checkDatabase: DatabaseHealthCheck;
  /** Operator status; the route exists only when configured (OPS_STATUS_TOKEN). */
  operations?: { token: string; read: OperationsStatusReader };
}

/**
 * GET /health        — liveness: the process is up (no dependency checks).
 * GET /health/ready  — readiness: dependencies such as PostgreSQL are reachable (503 otherwise).
 * GET /health/status — operator status (worker, queues, providers); bearer token, optional.
 */
export function createHealthRouter(dependencies: HealthModuleDependencies): Router {
  const controller = createHealthController(createHealthService(dependencies));
  const router = Router();

  router.get('/', controller.getLiveness);
  router.get('/ready', controller.getReadiness);
  const { operations } = dependencies;
  if (operations !== undefined) {
    router.get('/status', requireOperationsToken(operations.token), async (_req, res) => {
      const report = await operations.read();
      res.setHeader('Cache-Control', 'no-store');
      res.status(report.status === 'down' ? 503 : 200).json({ success: true, data: report });
    });
  }

  return router;
}
