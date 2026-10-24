import type { CurrencyCode } from '../constants/currencies';
import type { TransactionType } from '../constants/domain';
import type { EntityId, IsoDateTimeString, MinorUnitsString } from './common';

interface TransactionDtoBase {
  id: EntityId;
  userId: EntityId;
  /** Account the money moves in or out of; for transfers, the source account. */
  accountId: EntityId;
  /** Always a positive amount; the direction is defined by `type`. */
  amountMinor: MinorUnitsString;
  currency: CurrencyCode;
  description: string;
  merchant?: string;
  notes?: string;
  occurredAt: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface IncomeTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'income'>;
  categoryId?: EntityId;
}

export interface ExpenseTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'expense'>;
  categoryId?: EntityId;
}

/** Moves money between two accounts of the same user. Transfers are never categorised. */
export interface TransferTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'transfer'>;
  /** Destination account; always different from `accountId`. */
  transferAccountId: EntityId;
}

/** Discriminated on `type`, so code handling a transaction must narrow before using it. */
export type TransactionDto = IncomeTransactionDto | ExpenseTransactionDto | TransferTransactionDto;
