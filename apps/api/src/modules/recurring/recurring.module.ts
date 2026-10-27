import type { RecurringRepository } from './recurring.repository';

export interface RecurringModuleDependencies {
  repository: RecurringRepository;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}
