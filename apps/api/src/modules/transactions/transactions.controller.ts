import {
  entityIdSchema,
  IDEMPOTENCY_KEY_HEADER,
  type BulkTransactionInput,
  type BulkTransactionResultDto,
  type CreateReconciliationInput,
  type CreateTransactionInput,
  type ReconciliationPreviewDto,
  type ReconciliationPreviewInput,
  type TransactionFilterQuery,
  type TransactionListItemDto,
  type TransactionListQuery,
  type TransactionPageDto,
  type TransactionSummaryDto,
  type UpdateTransactionInput,
  type VoidTransactionInput,
} from '@calmcash/shared';
import type { Request } from 'express';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { TransactionsService, WriteOutcome } from './transactions.service';

interface TransactionParams {
  params: { transactionId: string };
}

export interface TransactionsController {
  list: Handler<{ query: TransactionListQuery }, TransactionPageDto>;
  summary: Handler<{ query: TransactionFilterQuery }, TransactionSummaryDto>;
  get: Handler<TransactionParams, TransactionListItemDto>;
  create: Handler<{ body: CreateTransactionInput }, TransactionListItemDto>;
  update: Handler<TransactionParams & { body: UpdateTransactionInput }, TransactionListItemDto>;
  void: Handler<TransactionParams & { body: VoidTransactionInput }, TransactionListItemDto>;
  restore: Handler<TransactionParams, TransactionListItemDto>;
  bulk: Handler<{ body: BulkTransactionInput }, BulkTransactionResultDto>;
  previewReconciliation: Handler<{ body: ReconciliationPreviewInput }, ReconciliationPreviewDto>;
  reconcile: Handler<{ body: CreateReconciliationInput }, TransactionListItemDto>;
}

/** The optional `Idempotency-Key` header: absent, or a UUID chosen by the client. */
export function readIdempotencyKey(req: Pick<Request, 'get'>): string | undefined {
  const value = req.get(IDEMPOTENCY_KEY_HEADER);
  if (value === undefined) {
    return undefined;
  }
  const parsed = entityIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
      details: [{ path: `headers.${IDEMPOTENCY_KEY_HEADER}`, message: 'Must be a UUID.' }],
    });
  }
  return parsed.data;
}

/** 201 when the money was recorded now; 200 when an earlier request with the key recorded it. */
function statusOf(outcome: WriteOutcome): number {
  return outcome.replayed ? 200 : 201;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createTransactionsController(
  service: TransactionsService,
  getCaller: (req: object) => Caller,
): TransactionsController {
  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    summary: async ({ query }, req, res) => {
      sendSuccess(res, await service.summary(getCaller(req), query));
    },
    get: async ({ params }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.transactionId));
    },
    create: async ({ body }, req, res) => {
      const outcome = await service.create(getCaller(req), body, readIdempotencyKey(req));
      sendSuccess(res, outcome.item, statusOf(outcome));
    },
    update: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.update(getCaller(req), params.transactionId, body));
    },
    void: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.void(getCaller(req), params.transactionId, body));
    },
    restore: async ({ params }, req, res) => {
      sendSuccess(res, await service.restore(getCaller(req), params.transactionId));
    },
    bulk: async ({ body }, req, res) => {
      sendSuccess(res, await service.bulk(getCaller(req), body));
    },
    previewReconciliation: async ({ body }, req, res) => {
      sendSuccess(res, await service.previewReconciliation(getCaller(req), body));
    },
    reconcile: async ({ body }, req, res) => {
      const outcome = await service.reconcile(getCaller(req), body, readIdempotencyKey(req));
      sendSuccess(res, outcome.item, statusOf(outcome));
    },
  };
}
