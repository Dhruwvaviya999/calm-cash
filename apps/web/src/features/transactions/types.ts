import type { AccountDto, CategoryDto, TransactionDto } from '@calmcash/shared';

/** A transaction with the related records a list row needs, all as shared API contracts. */
export interface TransactionListItem {
  transaction: TransactionDto;
  /** Account the money moved in or out of (the source for transfers). */
  account: AccountDto;
  category?: CategoryDto | undefined;
  /** Destination account, for transfers. */
  transferAccount?: AccountDto | undefined;
}
