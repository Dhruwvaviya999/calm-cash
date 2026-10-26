import { Router } from 'express';

import type { DatabaseHealthCheck } from '../lib/database';
import {
  createAuthRouter,
  type AuthModuleConfig,
  type AuthModuleDependencies,
} from '../modules/auth/auth.routes';
import { createHealthRouter } from '../modules/health/health.routes';

export interface V1RouterDependencies {
  checkDatabase: DatabaseHealthCheck;
  auth: AuthModuleDependencies;
  authConfig: AuthModuleConfig;
}

/**
 * Composition root of API v1 (mounted at `/api/v1`). Each feature module exposes a router
 * factory and receives only the dependencies it needs; modules never import each other's routes.
 */
export function createV1Router(dependencies: V1RouterDependencies): Router {
  const router = Router();

  router.use('/health', createHealthRouter({ checkDatabase: dependencies.checkDatabase }));
  router.use('/auth', createAuthRouter(dependencies.auth, dependencies.authConfig));

  return router;
}
