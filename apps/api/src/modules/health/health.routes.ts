import { Router } from 'express';

import type { DatabaseHealthCheck } from '../../lib/database';
import { createHealthController } from './health.controller';
import { createHealthService } from './health.service';

export interface HealthModuleDependencies {
  checkDatabase: DatabaseHealthCheck;
}

/**
 * GET /health        — liveness: the process is up (no dependency checks).
 * GET /health/ready  — readiness: dependencies such as PostgreSQL are reachable (503 otherwise).
 */
export function createHealthRouter(dependencies: HealthModuleDependencies): Router {
  const controller = createHealthController(createHealthService(dependencies));
  const router = Router();

  router.get('/', controller.getLiveness);
  router.get('/ready', controller.getReadiness);

  return router;
}
