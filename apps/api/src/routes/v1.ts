import { Router } from 'express';

import type { DatabaseHealthCheck } from '../lib/database';
import type { Logger } from '../lib/logger';
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
import { createGoalsService } from '../modules/goals/goals.service';
import { createAiRouter } from '../modules/ai/ai.routes';
import type { AiModuleDependencies, InsightsModuleDependencies } from '../modules/ai/ai.module';
import { createAiService } from '../modules/ai/ai.service';
import { createBudgetsService } from '../modules/budgets/budgets.service';
import { createCategoriesService } from '../modules/categories/categories.service';
import { createDashboardService } from '../modules/dashboard/dashboard.service';
import { createInsightsRouter } from '../modules/insights/insights.routes';
import {
  createIntelligenceRouter,
  type IntelligenceModuleDependencies,
} from '../modules/intelligence/intelligence.routes';
import { createIntelligenceService } from '../modules/intelligence/intelligence.service';
import { createInsightsService } from '../modules/insights/insights.service';
import { createSubscriptionsService } from '../modules/subscriptions/subscriptions.service';
import {
  createDataExportRouter,
  type DataExportModuleDependencies,
} from '../modules/data-export/data-export.routes';
import { createHealthRouter } from '../modules/health/health.routes';
import type { OperationsStatusReader } from '../modules/health/operations-status';
import {
  createNotificationsRouter,
  type NotificationsModuleDependencies,
} from '../modules/notifications';
import {
  createImportsRouter,
  type ImportsModuleDependencies,
} from '../modules/imports/imports.routes';
import {
  createReceiptsRouter,
  type ReceiptsModuleDependencies,
} from '../modules/receipts/receipts.routes';
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
  operationsStatus?: { token: string; read: OperationsStatusReader };
  logger: Logger;
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
  imports: ImportsModuleDependencies;
  receipts: ReceiptsModuleDependencies;
  notifications: NotificationsModuleDependencies;
  ai: AiModuleDependencies;
  insights: InsightsModuleDependencies;
  intelligence: IntelligenceModuleDependencies;
  dataExport?: DataExportModuleDependencies;
}

/**
 * Composition root of API v1 (mounted at `/api/v1`). Each feature module exposes a router
 * factory and receives only the dependencies it needs; modules never import each other's routes.
 * Protected modules receive the session guards from the auth module here.
 */
export function createV1Router(dependencies: V1RouterDependencies): Router {
  const router = Router();
  const auth = createAuthModule(dependencies.auth, dependencies.authConfig);

  router.use(
    '/health',
    createHealthRouter({
      checkDatabase: dependencies.checkDatabase,
      ...(dependencies.operationsStatus === undefined
        ? {}
        : { operations: dependencies.operationsStatus }),
    }),
  );
  router.use('/auth', auth.router);
  const boundary = {
    requireSession: auth.requireSession,
    requireCsrf: auth.requireCsrf,
    getCaller: auth.getCaller,
  };
  router.use('/accounts', createAccountsRouter(dependencies.accounts, boundary));
  // Receipts live under their transaction; mounted first so the transaction routes never see them.
  router.use(
    '/transactions/:transactionId/receipts',
    createReceiptsRouter(dependencies.receipts, dependencies.logger, boundary),
  );
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
  // One transactions service for every module that turns plans or statements into real money.
  const transactions = createTransactionsService({
    repository: dependencies.transactions.repository,
    now: dependencies.transactions.now ?? recurringNow,
  });
  const recurring = createRecurringService({
    repository: dependencies.recurring.repository,
    transactions,
    now: recurringNow,
  });
  router.use('/recurring', createRecurringRouter(recurring, boundary));
  // Subscriptions are recurring expense schedules: the same service behind scoped routes.
  router.use('/subscriptions', createSubscriptionsRouter(recurring, boundary));
  router.use('/goals', createGoalsRouter(dependencies.goals, boundary));

  // Statement imports (Phase 8): approved rows and balance corrections are recorded only through
  // the transactions service, with its locks and rules.
  router.use('/imports', createImportsRouter(dependencies.imports, transactions, boundary));

  // Notifications (Phase 9): the center and preferences. Notifications themselves are created by
  // the background worker (apps/worker) from events and schedules, never by a request.
  router.use('/notifications', createNotificationsRouter(dependencies.notifications, boundary));

  // AI and insights (Phase 10). Read-only views over the same services the pages use: deterministic
  // insights work without AI; the assistant plans with a local model but every figure comes from
  // these services, and nothing here writes money (drafts and suggestions are applied through the
  // ordinary endpoints by the person).
  const aiNow = dependencies.ai.now ?? ((): Date => new Date());
  const dashboard = createDashboardService({
    repository: dependencies.dashboard.repository,
    accountSummary: accounts.summary,
    now: aiNow,
  });
  const insights = createInsightsService({
    repository: dependencies.insights.repository,
    dashboard,
    now: aiNow,
  });
  router.use('/insights', createInsightsRouter(insights, boundary));

  // Financial intelligence (Phase 11): forecasts, predictions, suggestions, and scenarios computed
  // from the same services and the dashboard's cash-flow queries. Read-only over the ledger; it
  // stores only scenario assumptions and recommendation states.
  const intelligenceNow = dependencies.intelligence.now ?? aiNow;
  const subscriptions = createSubscriptionsService(recurring);
  const intelligence = createIntelligenceService({
    repository: dependencies.intelligence.repository,
    dashboard: dependencies.dashboard.repository,
    accounts,
    budgets: createBudgetsService({
      repository: dependencies.budgets.repository,
      now: intelligenceNow,
    }),
    recurring,
    subscriptions,
    goals: createGoalsService({ repository: dependencies.goals.repository, now: intelligenceNow }),
    now: intelligenceNow,
  });
  router.use(
    '/intelligence',
    createIntelligenceRouter(
      intelligence,
      boundary,
      dependencies.intelligence.rateLimit,
      dependencies.intelligence.rateLimitStore,
    ),
  );

  const toolServices = {
    dashboard,
    accounts,
    transactions,
    budgets: createBudgetsService({ repository: dependencies.budgets.repository, now: aiNow }),
    recurring,
    subscriptions,
    goals: createGoalsService({ repository: dependencies.goals.repository, now: aiNow }),
    insights,
    intelligence,
  };
  router.use(
    '/ai',
    createAiRouter(
      createAiService({
        repository: dependencies.ai.repository,
        provider: dependencies.ai.provider,
        serverEnabled: dependencies.ai.config.enabled,
        tools: toolServices,
        categories: createCategoriesService({
          repository: dependencies.categories.repository,
          now: aiNow,
        }),
        accounts,
        transactions,
        now: aiNow,
      }),
      boundary,
      dependencies.ai.config.rateLimit,
      dependencies.ai.rateLimitStore,
    ),
  );

  // Data export (Phase 12): the signed-in person's records as one JSON download.
  if (dependencies.dataExport !== undefined) {
    router.use(
      '/exports',
      createDataExportRouter(dependencies.dataExport, boundary, dependencies.logger),
    );
  }

  return router;
}
