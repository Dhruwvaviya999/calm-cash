import type {
  BudgetDetailQuery,
  BudgetListDto,
  BudgetListQuery,
  BudgetSummaryDto,
  BudgetSummaryQuery,
  BudgetWithProgressDto,
  CreateBudgetInput,
  UpdateBudgetInput,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { BudgetsService } from './budgets.service';

interface BudgetParams {
  params: { budgetId: string };
}

export interface BudgetsController {
  list: Handler<{ query: BudgetListQuery }, BudgetListDto>;
  summary: Handler<{ query: BudgetSummaryQuery }, BudgetSummaryDto>;
  get: Handler<BudgetParams & { query: BudgetDetailQuery }, BudgetWithProgressDto>;
  create: Handler<{ body: CreateBudgetInput }, BudgetWithProgressDto>;
  update: Handler<BudgetParams & { body: UpdateBudgetInput }, BudgetWithProgressDto>;
  archive: Handler<BudgetParams, BudgetWithProgressDto>;
  restore: Handler<BudgetParams, BudgetWithProgressDto>;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createBudgetsController(
  service: BudgetsService,
  getCaller: (req: object) => Caller,
): BudgetsController {
  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    summary: async ({ query }, req, res) => {
      sendSuccess(res, await service.summary(getCaller(req), query));
    },
    get: async ({ params, query }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.budgetId, query));
    },
    create: async ({ body }, req, res) => {
      sendSuccess(res, await service.create(getCaller(req), body), 201);
    },
    update: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.update(getCaller(req), params.budgetId, body));
    },
    archive: async ({ params }, req, res) => {
      sendSuccess(res, await service.archive(getCaller(req), params.budgetId));
    },
    restore: async ({ params }, req, res) => {
      sendSuccess(res, await service.restore(getCaller(req), params.budgetId));
    },
  };
}
