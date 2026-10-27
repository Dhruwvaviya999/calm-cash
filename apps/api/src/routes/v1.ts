import { Router } from 'express';

import type { DatabaseHealthCheck } from '../lib/database';
import {
  createAccountsRouter,
  type AccountsModuleDependencies,
} from '../modules/accounts/accounts.routes';
import { createAccountsService } from '../modules/accounts';
import {
  createBudgetsRouter,
  type BudgetsModuleDependencies,
} from '../modules/budgets/budgets.routes';
import {
  createDashboardRouter,
  type DashboardModuleDependencies,
} from '../modules/dashboard/dashboard.routes';
import {
  createCategoriesRouter,
  type CategoriesModuleDependencies,
} from '../modules/categories/categories.routes';
import {
  createAuthModule,
  type AuthModuleConfig,
  type AuthModuleDependencies,
} from '../modules/auth/auth.routes';
import { createGoalsRouter, type GoalsModuleDependencies } from '../modules/goals/goals.routes';
import { createHealthRouter } from '../modules/health/health.routes';
import {
  createRecurringRouter,
  createRecurringService,
  type RecurringModuleDependencies,
} from '../modules/recurring';
import { createSubscriptionsRouter } from '../modules/subscriptions/subscriptions.routes';
import { createTagsRouter, type TagsModuleDependencies } from '../modules/tags/tags.routes';
import {
  createTransactionsRouter,
  type TransactionsModuleDependencies,
} from '../modules/transactions/transactions.routes';
import { createTransactionsService } from '../modules/transactions';

export interface V1RouterDependencies {
  checkDatabase: DatabaseHealthCheck;
  auth: AuthModuleDependencies;
  authConfig: AuthModuleConfig;
  accounts: AccountsModuleDependencies;
  transactions: TransactionsModuleDependencies;
  categories: CategoriesModuleDependencies;
  tags: TagsModuleDependencies;
  dashboard: DashboardModuleDependencies;
  budgets: BudgetsModuleDependencies;
  recurring: RecurringModuleDependencies;
  goals: GoalsModuleDependencies;
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
  const boundary = {
    requireSession: auth.requireSession,
    requireCsrf: auth.requireCsrf,
    getCaller: auth.getCaller,
  };
  router.use('/accounts', createAccountsRouter(dependencies.accounts, boundary));
  router.use('/transactions', createTransactionsRouter(dependencies.transactions, boundary));
  router.use('/categories', createCategoriesRouter(dependencies.categories, boundary));
  router.use('/tags', createTagsRouter(dependencies.tags, boundary));
  // The dashboard reads the financial position from the accounts module's authoritative summary.
  const accounts = createAccountsService({
    repository: dependencies.accounts.repository,
    now: dependencies.accounts.now ?? ((): Date => new Date()),
  });
  router.use(
    '/dashboard',
    createDashboardRouter(dependencies.dashboard, accounts.summary, boundary),
  );

  // Planning (Phase 7). Confirming a scheduled payment records the real transaction through the
  // transactions module's ledger, so every lock and balance rule of ordinary entry applies.
  router.use('/budgets', createBudgetsRouter(dependencies.budgets, boundary));
  const recurringNow = dependencies.recurring.now ?? ((): Date => new Date());
  const recurring = createRecurringService({
    repository: dependencies.recurring.repository,
    transactions: createTransactionsService({
      repository: dependencies.transactions.repository,
      now: dependencies.transactions.now ?? recurringNow,
    }),
    now: recurringNow,
  });
  router.use('/recurring', createRecurringRouter(recurring, boundary));
  // Subscriptions are recurring expense schedules: the same service behind scoped routes.
  router.use('/subscriptions', createSubscriptionsRouter(recurring, boundary));
  router.use('/goals', createGoalsRouter(dependencies.goals, boundary));

  return router;
}
