import type {
  CreateSavingsGoalInput,
  GoalContributionInput,
  SavingsGoalDetailDto,
  SavingsGoalListDto,
  SavingsGoalListQuery,
  UpdateSavingsGoalInput,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { GoalAction, GoalsService } from './goals.service';

interface GoalParams {
  params: { goalId: string };
}

export interface GoalsController {
  list: Handler<{ query: SavingsGoalListQuery }, SavingsGoalListDto>;
  get: Handler<GoalParams, SavingsGoalDetailDto>;
  create: Handler<{ body: CreateSavingsGoalInput }, SavingsGoalDetailDto>;
  update: Handler<GoalParams & { body: UpdateSavingsGoalInput }, SavingsGoalDetailDto>;
  contribute: Handler<GoalParams & { body: GoalContributionInput }, SavingsGoalDetailDto>;
  act: (action: GoalAction) => Handler<GoalParams, SavingsGoalDetailDto>;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createGoalsController(
  service: GoalsService,
  getCaller: (req: object) => Caller,
): GoalsController {
  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    get: async ({ params }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.goalId));
    },
    create: async ({ body }, req, res) => {
      sendSuccess(res, await service.create(getCaller(req), body), 201);
    },
    update: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.update(getCaller(req), params.goalId, body));
    },
    contribute: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.contribute(getCaller(req), params.goalId, body), 201);
    },
    act:
      (action) =>
      async ({ params }, req, res) => {
        sendSuccess(res, await service.act(getCaller(req), params.goalId, action));
      },
  };
}
