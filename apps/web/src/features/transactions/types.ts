import type {
  TransactionAccountRefDto,
  TransactionCategoryRefDto,
  TransactionDto,
} from '@calmcash/shared';

/**
 * A transaction with the related records a list row needs. The API's `TransactionListItemDto`
 * fits as it is; full `AccountDto` and `CategoryDto` objects (as in the design preview) fit too.
 */
export interface TransactionListItem {
  transaction: TransactionDto;
  /** Account the money moved in or out of (the source for transfers). */
  account: TransactionAccountRefDto;
  category?: TransactionCategoryRefDto | undefined;
  /** Destination account, for transfers. */
  transferAccount?: TransactionAccountRefDto | undefined;
}
