import type {
  AccountListDto,
  AccountListQuery,
  AccountSummaryDto,
  AccountWithBalanceDto,
  ApiSuccessResponse,
  CreateAccountInput,
  UpdateAccountInput,
} from '@calmcash/shared';
import type { Request, Response } from 'express';

import { sendSuccess } from '../../lib/http-response';
import type { UnvalidatedRequest } from '../../middleware/validate-request';
import type { AccountsService, Caller } from './accounts.service';

type Ok<T> = Response<ApiSuccessResponse<T>>;
type Handler<TInput, TData> = (
  input: TInput,
  req: UnvalidatedRequest<ApiSuccessResponse<TData>>,
  res: Ok<TData>,
) => Promise<void>;

interface AccountParams {
  params: { accountId: string };
}

export interface AccountsController {
  list: Handler<{ query: AccountListQuery }, AccountListDto>;
  summary: (req: Request, res: Ok<AccountSummaryDto>) => Promise<void>;
  create: Handler<{ body: CreateAccountInput }, AccountWithBalanceDto>;
  get: Handler<AccountParams, AccountWithBalanceDto>;
  update: Handler<AccountParams & { body: UpdateAccountInput }, AccountWithBalanceDto>;
  archive: Handler<AccountParams, AccountWithBalanceDto>;
  restore: Handler<AccountParams, AccountWithBalanceDto>;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createAccountsController(
  service: AccountsService,
  getCaller: (req: object) => Caller,
): AccountsController {
  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    summary: async (req, res) => {
      sendSuccess(res, await service.summary(getCaller(req)));
    },
    create: async ({ body }, req, res) => {
      sendSuccess(res, await service.create(getCaller(req), body), 201);
    },
    get: async ({ params }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.accountId));
    },
    update: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.update(getCaller(req), params.accountId, body));
    },
    archive: async ({ params }, req, res) => {
      sendSuccess(res, await service.archive(getCaller(req), params.accountId));
    },
    restore: async ({ params }, req, res) => {
      sendSuccess(res, await service.restore(getCaller(req), params.accountId));
    },
  };
}
