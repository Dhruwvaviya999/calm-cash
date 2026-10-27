import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDto,
  SubscriptionListDto,
  SubscriptionListQuery,
  SubscriptionSummaryDto,
  UpdateSubscriptionInput,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { SubscriptionsService } from './subscriptions.service';

interface Params {
  params: { scheduleId: string };
}

type Lifecycle = Handler<Params, SubscriptionDto>;

export interface SubscriptionsController {
  list: Handler<{ query: SubscriptionListQuery }, SubscriptionListDto>;
  summary: Handler<object, SubscriptionSummaryDto>;
  create: Handler<{ body: CreateSubscriptionInput }, SubscriptionDto>;
  get: Handler<Params, SubscriptionDto>;
  update: Handler<Params & { body: UpdateSubscriptionInput }, SubscriptionDto>;
  cancel: Handler<Params & { body: CancelSubscriptionInput }, SubscriptionDto>;
  pause: Lifecycle;
  resume: Lifecycle;
  archive: Lifecycle;
  restore: Lifecycle;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createSubscriptionsController(
  service: SubscriptionsService,
  getCaller: (req: object) => Caller,
): SubscriptionsController {
  const lifecycle =
    (action: 'pause' | 'resume' | 'archive' | 'restore'): Lifecycle =>
    async ({ params }, req, res) => {
      sendSuccess(res, await service[action](getCaller(req), params.scheduleId));
    };
  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    summary: async (_input, req, res) => {
      sendSuccess(res, await service.summary(getCaller(req)));
    },
    create: async ({ body }, req, res) => {
      sendSuccess(res, await service.create(getCaller(req), body), 201);
    },
    get: async ({ params }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.scheduleId));
    },
    update: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.update(getCaller(req), params.scheduleId, body));
    },
    cancel: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.cancel(getCaller(req), params.scheduleId, body));
    },
    pause: lifecycle('pause'),
    resume: lifecycle('resume'),
    archive: lifecycle('archive'),
    restore: lifecycle('restore'),
  };
}
