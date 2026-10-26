import type {
  AccountClassification,
  AccountColor,
  AccountStatus,
  AccountStatusFilter,
  CreatableAccountType,
} from '../constants/accounts';
import type { CurrencyCode } from '../constants/currencies';
import type { AccountType } from '../constants/domain';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';

/**
 * A place money lives (cash, bank, savings, wallet) or a debt (credit card).
 *
 * Every balance is a signed *net position* in minor units of `currency`: positive means money
 * held (or a card in credit), negative means money owed. A credit card owing ₹12,500 therefore has
 * `openingBalanceMinor: "-1250000"`. `classification` says how to present it, and assets and
 * liabilities must never be added together as "money".
 */
export interface AccountDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  type: AccountType;
  /** Derived from `type`; included so clients never have to guess. */
  classification: AccountClassification;
  currency: CurrencyCode;
  /** Net position at the start of `openingBalanceDate`, before any recorded transaction. */
  openingBalanceMinor: MinorUnitsString;
  /** Calendar day (in the user's time zone) from which transactions count toward the balance. */
  openingBalanceDate: IsoDateString;
  /** Bank or provider name, e.g. "HDFC Bank". Never an account or card number. */
  institution?: string;
  /** Credit cards only: positive limit in minor units of `currency`. */
  creditLimitMinor?: MinorUnitsString;
  color?: AccountColor;
  status: AccountStatus;
  /** Present when `status` is `archived`. */
  archivedAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** Balance figures calculated by the API; clients display them and never recompute them. */
export interface AccountBalanceDto {
  /** Opening balance plus every counted transaction, as a signed net position. */
  currentBalanceMinor: MinorUnitsString;
  /** Liabilities only: amount owed, i.e. `-currentBalanceMinor` (negative while in credit). */
  amountOwedMinor?: MinorUnitsString;
  /** Credit cards with a limit only: `creditLimitMinor - amountOwedMinor` (negative over limit). */
  availableCreditMinor?: MinorUnitsString;
  /** Transactions included in the balance; 0 means it equals the opening balance. */
  countedTransactions: number;
}

export interface AccountWithBalanceDto {
  account: AccountDto;
  balance: AccountBalanceDto;
  /**
   * True once any transaction uses the account. The opening balance, its date, and the currency
   * are then locked, because changing them would rewrite the meaning of recorded history.
   */
  hasTransactions: boolean;
}

export interface AccountListDto {
  accounts: AccountWithBalanceDto[];
}

/** Totals of active accounts in one currency. Different currencies are never added together. */
export interface CurrencyBalanceSummaryDto {
  currency: CurrencyCode;
  /** Sum of asset balances (an overdraft reduces it). */
  assetsMinor: MinorUnitsString;
  /** Sum of amounts owed on liabilities (a card in credit reduces it). */
  liabilitiesMinor: MinorUnitsString;
  assetAccounts: number;
  liabilityAccounts: number;
}

export interface AccountSummaryDto {
  /** One entry per currency in use, ordered by currency code. */
  currencies: CurrencyBalanceSummaryDto[];
}

// --- Requests ----------------------------------------------------------------------------------

export interface CreateAccountInput {
  name: string;
  type: CreatableAccountType;
  currency: CurrencyCode;
  /** Required, so a zero balance is always a deliberate choice, never a missing value. */
  openingBalanceMinor: MinorUnitsString;
  /** Defaults to today in the user's time zone. */
  openingBalanceDate?: IsoDateString;
  institution?: string;
  creditLimitMinor?: MinorUnitsString;
  color?: AccountColor;
}

/** Partial update; `null` clears an optional field. */
export interface UpdateAccountInput {
  name?: string;
  type?: CreatableAccountType;
  currency?: CurrencyCode;
  openingBalanceMinor?: MinorUnitsString;
  openingBalanceDate?: IsoDateString;
  institution?: string | null;
  creditLimitMinor?: MinorUnitsString | null;
  color?: AccountColor | null;
}

/** Query of `GET /accounts`. */
export interface AccountListQuery {
  /** Defaults to `active`. */
  status: AccountStatusFilter;
  type?: AccountType;
}
