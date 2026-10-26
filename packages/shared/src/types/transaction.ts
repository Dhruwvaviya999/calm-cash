import type { AccountStatus } from '../constants/accounts';
import type { CurrencyCode } from '../constants/currencies';
import type {
  AccountType,
  AdjustmentDirection,
  CategoryKind,
  PaymentMethod,
  TransactionType,
} from '../constants/domain';
import type {
  BulkTransactionAction,
  TransactionSort,
  TransactionStatus,
  TransactionStatusFilter,
} from '../constants/transactions';
import type { AccountBalanceDto } from './account';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';

interface TransactionDtoBase {
  id: EntityId;
  userId: EntityId;
  /** Account the money moves in or out of; for transfers, the source account. */
  accountId: EntityId;
  /** Always a positive amount; the direction is defined by `type` (and `adjustmentDirection`). */
  amountMinor: MinorUnitsString;
  /** Always the currency of the account(s) involved. */
  currency: CurrencyCode;
  /** What the money was for; for balance adjustments, the reason for the correction. */
  description: string;
  notes?: string;
  /** Normalised labels (lower case, hyphenated), at most 10. Empty when none. */
  tags: string[];
  status: TransactionStatus;
  /** Present when `status` is `voided`. */
  voidedAt?: IsoDateTimeString;
  voidReason?: string;
  occurredAt: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** Money received: increases the account's signed balance. */
export interface IncomeTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'income'>;
  /** Who paid: employer, client, payer. */
  merchant?: string;
  categoryId?: EntityId;
  paymentMethod?: PaymentMethod;
}

/** Money spent: decreases the account's signed balance. */
export interface ExpenseTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'expense'>;
  /** Where the money went: merchant or recipient. */
  merchant?: string;
  categoryId?: EntityId;
  paymentMethod?: PaymentMethod;
}

/**
 * Moves money between two accounts of the same user and currency, recorded once. Transfers are
 * never categorised and never count as income or spending.
 */
export interface TransferTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'transfer'>;
  /** Destination account; always different from `accountId`. */
  transferAccountId: EntityId;
  paymentMethod?: PaymentMethod;
}

/**
 * Corrects one account's balance by `amountMinor` in `adjustmentDirection` (reconciliation).
 * Never income, spending, or a transfer.
 */
export interface BalanceAdjustmentTransactionDto extends TransactionDtoBase {
  type: Extract<TransactionType, 'balance_adjustment'>;
  adjustmentDirection: AdjustmentDirection;
}

/** Discriminated on `type`, so code handling a transaction must narrow before using it. */
export type TransactionDto =
  | IncomeTransactionDto
  | ExpenseTransactionDto
  | TransferTransactionDto
  | BalanceAdjustmentTransactionDto;

/** What a transaction row needs to know about an account, archived ones included. */
export interface TransactionAccountRefDto {
  id: EntityId;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  status: AccountStatus;
}

export interface TransactionCategoryRefDto {
  id: EntityId;
  name: string;
  kind: CategoryKind;
  /** Present on subcategories. */
  parentId?: EntityId;
  parentName?: string;
}

/** A transaction with the names a list or detail view shows next to it. */
export interface TransactionListItemDto {
  transaction: TransactionDto;
  account: TransactionAccountRefDto;
  /** Transfers only: the destination account. */
  transferAccount?: TransactionAccountRefDto;
  category?: TransactionCategoryRefDto;
}

export interface PaginationDto {
  /** 1-based. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** 0 when nothing matches. */
  totalPages: number;
}

export interface TransactionPageDto {
  items: TransactionListItemDto[];
  pagination: PaginationDto;
}

/** Income and spending in one currency for the filtered transactions (never converted). */
export interface CurrencyCashFlowDto {
  currency: CurrencyCode;
  incomeMinor: MinorUnitsString;
  expenseMinor: MinorUnitsString;
  /** `incomeMinor - expenseMinor`; negative when more went out than came in. */
  netMinor: MinorUnitsString;
  incomeCount: number;
  expenseCount: number;
}

/**
 * Cash flow of the transactions matching the same filters as the list. Transfers and balance
 * adjustments are excluded: they are neither income nor spending.
 */
export interface TransactionSummaryDto {
  currencies: CurrencyCashFlowDto[];
}

export interface TagUsageDto {
  tag: string;
  /** Active transactions carrying the tag. */
  count: number;
}

export interface TagListDto {
  tags: TagUsageDto[];
}

// --- Queries -----------------------------------------------------------------------------------

/** Filters shared by `GET /transactions` and `GET /transactions/summary`. */
export interface TransactionFilterQuery {
  /** Matches description, merchant, notes, category name, or a tag. */
  q?: string;
  type?: TransactionType;
  /** Matches the source or destination account. */
  accountId?: EntityId;
  /** Matches the category and its subcategories. */
  categoryId?: EntityId;
  paymentMethod?: PaymentMethod;
  /** Transactions carrying all of these tags. */
  tags?: string[];
  /** Calendar dates in the user's time zone, inclusive. */
  from?: IsoDateString;
  to?: IsoDateString;
  /** Major-unit amounts, e.g. `"500"`, applied in each transaction's currency. */
  minAmount?: string;
  maxAmount?: string;
  /** Defaults to `active`. */
  status: TransactionStatusFilter;
}

export interface TransactionListQuery extends TransactionFilterQuery {
  page: number;
  pageSize: number;
  sort: TransactionSort;
}

// --- Requests ----------------------------------------------------------------------------------

interface TransactionInputBase {
  accountId: EntityId;
  /** Positive minor units; the currency is the account's. */
  amountMinor: MinorUnitsString;
  occurredAt: IsoDateTimeString;
  notes?: string;
  tags?: string[];
}

export interface CreateIncomeTransactionInput extends TransactionInputBase {
  type: Extract<TransactionType, 'income'>;
  description: string;
  categoryId: EntityId;
  merchant?: string;
  paymentMethod?: PaymentMethod;
}

export interface CreateExpenseTransactionInput extends TransactionInputBase {
  type: Extract<TransactionType, 'expense'>;
  description: string;
  categoryId: EntityId;
  merchant?: string;
  paymentMethod?: PaymentMethod;
}

export interface CreateTransferTransactionInput extends TransactionInputBase {
  type: Extract<TransactionType, 'transfer'>;
  transferAccountId: EntityId;
  /** Defaults to "Transfer between accounts". */
  description?: string;
  paymentMethod?: PaymentMethod;
}

export interface CreateBalanceAdjustmentInput extends TransactionInputBase {
  type: Extract<TransactionType, 'balance_adjustment'>;
  adjustmentDirection: AdjustmentDirection;
  /** Why the balance needed correcting; required. */
  description: string;
}

export type CreateTransactionInput =
  | CreateIncomeTransactionInput
  | CreateExpenseTransactionInput
  | CreateTransferTransactionInput
  | CreateBalanceAdjustmentInput;

/**
 * Partial update. The merged result must be a valid transaction of its (possibly new) type:
 * fields the type does not use must be cleared with `null`, never left behind or ignored.
 */
export interface UpdateTransactionInput {
  type?: TransactionType;
  accountId?: EntityId;
  transferAccountId?: EntityId | null;
  amountMinor?: MinorUnitsString;
  occurredAt?: IsoDateTimeString;
  description?: string;
  merchant?: string | null;
  categoryId?: EntityId | null;
  paymentMethod?: PaymentMethod | null;
  adjustmentDirection?: AdjustmentDirection | null;
  notes?: string | null;
  /** Replaces the tags; `[]` removes them all. */
  tags?: string[];
}

export interface VoidTransactionInput {
  reason?: string;
}

/** The balance a bank, cash count, or statement shows, compared with CalmCash's. */
export interface ReconciliationPreviewInput {
  accountId: EntityId;
  /** Signed net position (negative = owed), like every balance in the API. */
  observedBalanceMinor: MinorUnitsString;
  /** When the observed balance was true; the comparison uses CalmCash's balance at that instant. */
  asOf: IsoDateTimeString;
}

export interface ReconciliationAdjustmentDto {
  direction: AdjustmentDirection;
  amountMinor: MinorUnitsString;
}

export interface ReconciliationPreviewDto {
  accountId: EntityId;
  currency: CurrencyCode;
  asOf: IsoDateTimeString;
  observedBalanceMinor: MinorUnitsString;
  /** CalmCash's balance at `asOf`, before any adjustment. */
  before: AccountBalanceDto;
  /** The balance at `asOf` once the adjustment is recorded (equals the observed balance). */
  after: AccountBalanceDto;
  /** Absent when the balances already match. */
  adjustment?: ReconciliationAdjustmentDto;
}

export interface CreateReconciliationInput extends ReconciliationPreviewInput {
  /** Why the balances differ; stored as the adjustment's description. */
  description: string;
  notes?: string;
  tags?: string[];
  /**
   * The signed change the person confirmed (from the preview). If the balance moved since then,
   * the request is refused instead of recording a different correction.
   */
  expectedAdjustmentMinor: MinorUnitsString;
}

export type BulkTransactionInput =
  | {
      action: Extract<BulkTransactionAction, 'set_category'>;
      transactionIds: EntityId[];
      categoryId: EntityId;
    }
  | {
      action: Extract<BulkTransactionAction, 'add_tags' | 'remove_tags'>;
      transactionIds: EntityId[];
      tags: string[];
    }
  | {
      action: Extract<BulkTransactionAction, 'void'>;
      transactionIds: EntityId[];
      reason?: string;
    };

/** A bulk request is applied to every selected transaction, or to none. */
export interface BulkTransactionResultDto {
  action: BulkTransactionAction;
  /** Transactions selected. */
  requested: number;
  /** Transactions actually changed (e.g. already-voided ones are not voided again). */
  changed: number;
}
