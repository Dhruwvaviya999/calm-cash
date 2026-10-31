import {
  entityIdSchema,
  markNotificationsReadInputSchema,
  notificationListQuerySchema,
  updateNotificationPreferencesInputSchema,
} from '@calmcash/shared';
import { Router } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import { validateRequest } from '../../middleware/validate-request';
import { createNotificationsController } from './notifications.controller';
import type { NotificationsRepository } from './notifications.repository';
import { createNotificationsService } from './notifications.service';

export interface NotificationsModuleDependencies {
  repository: NotificationsRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const notificationParams = z.object({ notificationId: entityIdSchema });
const noQuery = z.object({ query: z.strictObject({}) });

/**
 * The signed-in user's notification center and notification preferences. Every route requires a
 * session; state-changing routes also require the CSRF token; responses are `no-store`. The owner
 * always comes from the session — another user's notification answers exactly like a missing one.
 * Notifications are created by the background worker, never by these routes.
 *
 * GET    /                          list, newest first (`status=all|unread`, `page`, `pageSize` ≤ 50)
 * GET    /unread-count              unread notifications in the center
 * POST   /read                      mark up to 100 notifications read (`{ ids }`)
 * POST   /read-all                  mark every notification read
 * POST   /:notificationId/read      mark one read (idempotent)
 * POST   /:notificationId/dismiss   hide one from the center (idempotent)
 * GET    /preferences               categories, channels, lead times, e-mail and worker status
 * PATCH  /preferences               change preferences (partial)
 */
export function createNotificationsRouter(
  dependencies: NotificationsModuleDependencies,
  auth: AuthBoundary,
): Router {
  const service = createNotificationsService({
    repository: dependencies.repository,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const controller = createNotificationsController(service, auth.getCaller);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);

  router.get(
    '/',
    validateRequest(z.object({ query: notificationListQuerySchema }), controller.list),
  );
  router.get('/unread-count', validateRequest(noQuery, controller.unreadCount));
  router.get('/preferences', validateRequest(noQuery, controller.preferences));
  router.patch(
    '/preferences',
    validateRequest(
      z.object({ body: updateNotificationPreferencesInputSchema }),
      controller.updatePreferences,
    ),
  );
  router.post(
    '/read',
    validateRequest(z.object({ body: markNotificationsReadInputSchema }), controller.markManyRead),
  );
  router.post('/read-all', validateRequest(noQuery, controller.markAllRead));
  router.post(
    '/:notificationId/read',
    validateRequest(z.object({ params: notificationParams }), controller.markRead),
  );
  router.post(
    '/:notificationId/dismiss',
    validateRequest(z.object({ params: notificationParams }), controller.dismiss),
  );

  return router;
}
