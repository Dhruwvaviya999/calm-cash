import {
  createRecurringScheduleInputSchema,
  endRecurringScheduleInputSchema,
  entityIdSchema,
  isoDateSchema,
  linkOccurrenceInputSchema,
  postponeOccurrenceInputSchema,
  recordOccurrenceInputSchema,
  recurringListQuerySchema,
  upcomingOccurrencesQuerySchema,
  updateRecurringScheduleInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createRecurringController } from './recurring.controller';
import type { RecurringService } from './recurring.service';

const scheduleParams = z.object({ scheduleId: entityIdSchema });
const occurrenceParams = z.object({ scheduleId: entityIdSchema, date: isoDateSchema });

/**
 * Recurring income and expenses. Every route requires a session; state-changing routes also
 * require the CSRF token. Schedules are plans: only `…/record` moves money, by recording a real
 * transaction through the transactions module; `…/link` settles a payment with a transaction the
 * person already recorded (e.g. an imported bank row) and moves nothing.
 *
 * GET    /                                           list (`status`, `type`, `subscription`)
 * GET    /upcoming                                   overdue and due occurrences (`from`, `to`, …)
 * POST   /                                           create
 * GET    /:scheduleId                                details: next occurrences and history
 * PATCH  /:scheduleId                                update (future occurrences only)
 * POST   /:scheduleId/pause | resume | archive | restore   lifecycle (idempotent)
 * POST   /:scheduleId/end                            last date occurrences may fall on
 * POST   /:scheduleId/occurrences/:date/record       record the real transaction (exactly once)
 * GET    /:scheduleId/occurrences/:date/link-candidates   existing transactions that could settle it
 * POST   /:scheduleId/occurrences/:date/link         settle it with an existing transaction
 * POST   /:scheduleId/occurrences/:date/skip         not this time (idempotent)
 * POST   /:scheduleId/occurrences/:date/unskip       expect it after all
 * POST   /:scheduleId/occurrences/:date/postpone     move the due date later
 */
export function createRecurringRouter(service: RecurringService, auth: AuthBoundary): Router {
  const controller = createRecurringController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  const params = z.object({ params: scheduleParams });
  const occurrence = z.object({ params: occurrenceParams });

  router.get('/', validateRequest(z.object({ query: recurringListQuerySchema }), controller.list));
  router.get(
    '/upcoming',
    validateRequest(z.object({ query: upcomingOccurrencesQuerySchema }), controller.upcoming),
  );
  router.post(
    '/',
    validateRequest(z.object({ body: createRecurringScheduleInputSchema }), controller.create),
  );
  router.get('/:scheduleId', validateRequest(params, controller.get));
  router.patch(
    '/:scheduleId',
    validateRequest(
      z.object({ params: scheduleParams, body: updateRecurringScheduleInputSchema }),
      controller.update,
    ),
  );
  router.post('/:scheduleId/pause', validateRequest(params, controller.pause));
  router.post('/:scheduleId/resume', validateRequest(params, controller.resume));
  router.post('/:scheduleId/archive', validateRequest(params, controller.archive));
  router.post('/:scheduleId/restore', validateRequest(params, controller.restore));
  router.post(
    '/:scheduleId/end',
    validateRequest(
      z.object({ params: scheduleParams, body: endRecurringScheduleInputSchema.default({}) }),
      controller.end,
    ),
  );
  router.post(
    '/:scheduleId/occurrences/:date/record',
    validateRequest(
      z.object({ params: occurrenceParams, body: recordOccurrenceInputSchema.default({}) }),
      controller.record,
    ),
  );
  router.get(
    '/:scheduleId/occurrences/:date/link-candidates',
    validateRequest(occurrence, controller.linkCandidates),
  );
  router.post(
    '/:scheduleId/occurrences/:date/link',
    validateRequest(
      z.object({ params: occurrenceParams, body: linkOccurrenceInputSchema }),
      controller.link,
    ),
  );
  router.post('/:scheduleId/occurrences/:date/skip', validateRequest(occurrence, controller.skip));
  router.post(
    '/:scheduleId/occurrences/:date/unskip',
    validateRequest(occurrence, controller.unskip),
  );
  router.post(
    '/:scheduleId/occurrences/:date/postpone',
    validateRequest(
      z.object({ params: occurrenceParams, body: postponeOccurrenceInputSchema }),
      controller.postpone,
    ),
  );

  return router;
}
