// Public surface of the transactions module for other API modules. Money is recorded in exactly
// one place: the service's ledger writes (locks, ownership, archive, date, category, and balance
// rules). Modules that turn a plan into real money (confirming a scheduled occurrence) receive the
// service through the composition root and use `recordLinked`; they never write transactions or
// balances themselves.
export { toTransactionListItemDto } from './transactions.mapper';
export type { LinkedWriteClient } from './transactions.repository';
export {
  createTransactionsService,
  type LinkedRecording,
  type TransactionsService,
  type WriteOutcome,
} from './transactions.service';
