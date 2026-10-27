// Public surface of the accounts module for other API modules. Balances have exactly one
// definition: the pure arithmetic in `account-balance.ts` and the ledger query and row lock in
// `account-ledger.ts`. Modules that record money (transactions) reuse them from here and never
// re-implement them.
export {
  adjustmentBetween,
  breaksNonNegativeRule,
  calculateCurrentBalance,
  describeAccountBalance,
  NO_MOVEMENTS,
  signedAdjustment,
  withAdjustment,
  type BalanceAdjustment,
  type MovementTotals,
} from './account-balance';
export {
  lockAccounts,
  queryMovementTotals,
  readCountsFrom,
  type LedgerClient,
  type MovementQuery,
} from './account-ledger';
export { toAccountDto, toIsoDate } from './accounts.mapper';
export type { AccountRecord } from './accounts.repository';
export { createAccountsService, type AccountsService, type Caller } from './accounts.service';
