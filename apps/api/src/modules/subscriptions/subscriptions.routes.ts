import {
  cancelSubscriptionInputSchema,
  createSubscriptionInputSchema,
  entityIdSchema,
  subscriptionListQuerySchema,
  updateSubscriptionInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import type { RecurringService } from '../recurring';
import { createSubscriptionsController } from './subscriptions.controller';
import { createSubscriptionsService } from './subscriptions.service';

const subscriptionParams = z.object({ scheduleId: entityIdSchema });

/**
 * Subscriptions: recurring expenses the person tracks as such. Every route requires a session;
 * state-changing routes also require the CSRF token. Recording a charge uses the recurring
 * module's `…/occurrences/:date/record` route, like any other schedule.
 *
 * GET    /                         list with twelve-month estimates (`status`)
 * GET    /summary                  estimated upcoming costs per currency
 * POST   /                         create
 * GET    /:scheduleId              one subscription
 * PATCH  /:scheduleId              update
 * POST   /:scheduleId/pause | resume | archive | restore   lifecycle (idempotent)
 * POST   /:scheduleId/cancel       cancel from a date (default today; idempotent)
 */
export function createSubscriptionsRouter(recurring: RecurringService, auth: AuthBoundary): Router {
  const controller = createSubscriptionsController(
    createSubscriptionsService(recurring),
    auth.getCaller,
  );
  const router = Router();
  const params = z.object({ params: subscriptionParams });

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get(
    '/',
    validateRequest(z.object({ query: subscriptionListQuerySchema }), controller.list),
  );
  router.get('/summary', validateRequest(z.object({}), controller.summary));
  router.post(
    '/',
    validateRequest(z.object({ body: createSubscriptionInputSchema }), controller.create),
  );
  router.get('/:scheduleId', validateRequest(params, controller.get));
  router.patch(
    '/:scheduleId',
    validateRequest(
      z.object({ params: subscriptionParams, body: updateSubscriptionInputSchema }),
      controller.update,
    ),
  );
  router.post(
    '/:scheduleId/cancel',
    validateRequest(
      z.object({ params: subscriptionParams, body: cancelSubscriptionInputSchema.default({}) }),
      controller.cancel,
    ),
  );
  router.post('/:scheduleId/pause', validateRequest(params, controller.pause));
  router.post('/:scheduleId/resume', validateRequest(params, controller.resume));
  router.post('/:scheduleId/archive', validateRequest(params, controller.archive));
  router.post('/:scheduleId/restore', validateRequest(params, controller.restore));

  return router;
}
