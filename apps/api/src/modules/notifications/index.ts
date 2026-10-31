// Public surface of the notifications module for the rest of the API and for the automation
// worker: the routes, the repository, and the one definition of what a preference means.
export {
  applyPreferencePatch,
  channelsForType,
  DEFAULT_PREFERENCES,
  resolvePreferences,
  type ResolvedPreferences,
} from './notification-preferences';
export { readTarget, toNotificationDto } from './notifications.mapper';
export {
  createPrismaNotificationsRepository,
  type NotificationsRepository,
} from './notifications.repository';
export {
  createNotificationsRouter,
  type NotificationsModuleDependencies,
} from './notifications.routes';
export { WORKER_HEARTBEAT_STALE_MS } from './notifications.service';
