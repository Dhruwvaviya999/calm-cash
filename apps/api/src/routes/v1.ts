import { Router } from 'express';

import type { DatabaseHealthCheck } from '../lib/database';
import {
  createAccountsRouter,
  type AccountsModuleDependencies,
} from '../modules/accounts/accounts.routes';
import {
  createAuthModule,
  type AuthModuleConfig,
  type AuthModuleDependencies,
} from '../modules/auth/auth.routes';
import { createHealthRouter } from '../modules/health/health.routes';

export interface V1RouterDependencies {
  checkDatabase: DatabaseHealthCheck;
  auth: AuthModuleDependencies;
  authConfig: AuthModuleConfig;
  accounts: AccountsModuleDependencies;
}

/**
 * Composition root of API v1 (mounted at `/api/v1`). Each feature module exposes a router
 * factory and receives only the dependencies it needs; modules never import each other's routes.
 * Protected modules receive the session guards from the auth module here.
 */
export function createV1Router(dependencies: V1RouterDependencies): Router {
  const router = Router();
  const auth = createAuthModule(dependencies.auth, dependencies.authConfig);

  router.use('/health', createHealthRouter({ checkDatabase: dependencies.checkDatabase }));
  router.use('/auth', auth.router);
  router.use(
    '/accounts',
    createAccountsRouter(dependencies.accounts, {
      requireSession: auth.requireSession,
      requireCsrf: auth.requireCsrf,
      getCaller: auth.getCaller,
    }),
  );

  return router;
}
