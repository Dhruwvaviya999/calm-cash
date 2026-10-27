import type {
  DashboardPeriod,
  RatioUnavailableReason,
  TrendGranularity,
} from '../constants/dashboard';
import type { CurrencyCode } from '../constants/currencies';
import type { AccountSummaryDto } from './account';
import type { EntityId, IsoDateString, MinorUnitsString, TimeZoneId } from './common';

// Dashboard analytics. Two kinds of figures, never mixed: the *financial position* (what accounts
// hold and owe right now, from the account-balance service) and *cash flow* (income and spending
// within a period). Cash flow counts only active income and expense transactions in one currency;
// transfers, balance adjustments, and voided transactions are never income or spending.

// --- Query -------------------------------------------------------------------------------------

/** Query of every `/dashboard/*` endpoint. */
export interface DashboardQuery {
  /** Defaults to `this-month`. `custom` requires `from` and `to`; presets accept neither. */
  period: DashboardPeriod;
  /** Calendar dates in the user's time zone, inclusive; not in the future. */
  from?: IsoDateString;
  to?: IsoDateString;
  /** Defaults to the user's preferred currency (or their only one). */
  currency?: CurrencyCode;
}

// --- Common parts -----------------------------------------------------------------------------

/** The period the figures cover, as resolved by the API. */
export interface DashboardPeriodDto {
  period: DashboardPeriod;
  from: IsoDateString;
  to: IsoDateString;
  /** The time zone whose calendar days `from` and `to` are. */
  timeZone: TimeZoneId;
}

/** A ratio in basis points (1 bp = 0.01 percentage point), or why it does not exist. */
export type RatioDto =
  | { status: 'available'; basisPoints: string }
  | { status: 'unavailable'; reason: RatioUnavailableReason };

export interface CashFlowTotalsDto {
  incomeMinor: MinorUnitsString;
  expenseMinor: MinorUnitsString;
  /** `incomeMinor − expenseMinor`. */
  netMinor: MinorUnitsString;
  incomeCount: number;
  expenseCount: number;
}

// --- Overview -----------------------------------------------------------------------------------

export interface MetricChangeDto {
  previousMinor: MinorUnitsString;
  /** Current minus previous. */
  changeMinor: MinorUnitsString;
  /** Relative change; unavailable when the previous value is zero. */
  changePercent: RatioDto;
}

export type PeriodComparisonDto =
  | {
      status: 'available';
      /** The comparable earlier period (see `previousRange`). */
      from: IsoDateString;
      to: IsoDateString;
      income: MetricChangeDto;
      expense: MetricChangeDto;
      /** Net has no percentage: it can be zero or cross zero. */
      net: { previousMinor: MinorUnitsString; changeMinor: MinorUnitsString };
    }
  | {
      status: 'unavailable';
      from: IsoDateString;
      to: IsoDateString;
      /** No income or expense was recorded in the earlier period, so there is nothing to compare. */
      reason: 'no_previous_activity';
    };

export interface DashboardOverviewDto {
  period: DashboardPeriodDto;
  /** The currency every cash-flow figure is in. */
  currency: CurrencyCode;
  /** Currencies of the user's accounts (active or archived), preferred currency first. */
  currencies: CurrencyCode[];
  /** Money held and owed right now, per currency, from active accounts. Not period-dependent. */
  position: AccountSummaryDto;
  accounts: { active: number; archived: number };
  /** Whether the user has recorded any (non-voided) transaction at all, in any currency. */
  hasTransactions: boolean;
  cashFlow: CashFlowTotalsDto;
  /** (income − expenses) ÷ income for the period; unavailable without income. */
  savingsRate: RatioDto;
  comparison: PeriodComparisonDto;
}

// --- Trends -------------------------------------------------------------------------------------

export interface TrendBucketDto {
  /** First and last day of the bucket inside the period. */
  start: IsoDateString;
  end: IsoDateString;
  /** The period covers only part of this bucket (e.g. the current month so far). */
  partial: boolean;
  incomeMinor: MinorUnitsString;
  expenseMinor: MinorUnitsString;
  netMinor: MinorUnitsString;
}

export interface DashboardTrendsDto {
  period: DashboardPeriodDto;
  currency: CurrencyCode;
  granularity: TrendGranularity;
  /** Every bucket of the period in order; a bucket without activity has zero totals. */
  buckets: TrendBucketDto[];
}

// --- Categories ---------------------------------------------------------------------------------

interface CategorySpendBase {
  amountMinor: MinorUnitsString;
  transactionCount: number;
  /** Share of the period's spending in this currency. */
  shareBasisPoints: string;
}

/** Spending of one top-level category, its subcategories included. */
export interface CategorySpendDto extends CategorySpendBase {
  kind: 'category';
  categoryId: EntityId;
  name: string;
  /** Archived categories still appear when past spending used them. */
  archived: boolean;
}

/** Expenses without a category (only present when such expenses exist). */
export interface UncategorizedSpendDto extends CategorySpendBase {
  kind: 'uncategorized';
}

/** Everything beyond the categories listed by name, added up exactly. */
export interface OtherSpendDto extends CategorySpendBase {
  kind: 'other';
  categoryCount: number;
}

export type CategorySpendEntryDto = CategorySpendDto | UncategorizedSpendDto | OtherSpendDto;

export interface DashboardCategoriesDto {
  period: DashboardPeriodDto;
  currency: CurrencyCode;
  totalExpenseMinor: MinorUnitsString;
  expenseCount: number;
  /**
   * Largest first (ties by name); uncategorised spending competes for a place like any category,
   * and "Other" (everything past the limit) always comes last.
   */
  entries: CategorySpendEntryDto[];
}
