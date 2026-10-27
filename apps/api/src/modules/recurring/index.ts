// Public surface of the recurring module for other API modules. Recurrence has one definition:
// subscriptions are schedules, so they reuse this service instead of calculating dates again.
export type { RecurringRepository } from './recurring.repository';
export { createPrismaRecurringRepository } from './recurring.repository';
export type { RecurringModuleDependencies } from './recurring.module';
export { createRecurringRouter } from './recurring.routes';
export {
  createRecurringService,
  type CollectOptions,
  type RecurringService,
} from './recurring.service';
