import type { CurrencyCode } from '../constants/currencies';
import type { BudgetPeriod } from '../constants/domain';
import type {
  BudgetProgressStatus,
  BudgetStatus,
  BudgetStatusFilter,
  BudgetTiming,
  RecurringBudgetPeriod,
} from '../constants/planning';
import type { CategoryStatus } from '../constants/transactions';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';
import type { RatioDto } from './dashboard';
import type { TransactionCategoryRefDto } from './transaction';

export interface BudgetDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  description?: string;
  /** Absent when the budget covers all expense categories (an overall budget). */
  categoryId?: EntityId;
  /** Positive spending limit per period. */
  limitMinor: MinorUnitsString;
  currency: CurrencyCode;
  period: BudgetPeriod;
  /** First day of the budget (inclusive), in the user's time zone. */
  startDate: IsoDateString;
  /** Last day of the budget (inclusive). Required when `period` is `custom`. */
  endDate?: IsoDateString;
  /** In-app alerts in basis points of the limit, ascending (e.g. `[8000]` = at 80 %). */
  alertThresholdsBp: number[];
  status: BudgetStatus;
  /** Present when `status` is `archived`. */
  archivedAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** Actual spending against a budget in one period, calculated from the ledger by the API. */
export interface BudgetProgressDto {
  /** The period shown: inclusive calendar dates in the user's time zone. */
  from: IsoDateString;
  to: IsoDateString;
  /** True when the budget's start or end date cuts the calendar period short. */
  partial: boolean;
  timing: BudgetTiming;
  limitMinor: MinorUnitsString;
  /** Active expenses in the budget's currency and scope with `occurredAt` in the period. */
  spentMinor: MinorUnitsString;
  /** Limit − spent; negative when overspent (never clamped). */
  remainingMinor: MinorUnitsString;
  /** Spent ÷ limit in basis points, uncapped; unavailable (`no_limit`) without a positive limit. */
  used: RatioDto;
  status: BudgetProgressStatus;
  /** The highest alert threshold reached, if any. */
  reachedThresholdBp?: number;
  /** Expenses counted. */
  transactionCount: number;
}

/** A category as planning views show it: its name, place in the tree, and whether it is archived. */
export interface PlanningCategoryRefDto extends TransactionCategoryRefDto {
  status: CategoryStatus;
}

export interface BudgetWithProgressDto {
  budget: BudgetDto;
  /** The budget's category (absent for overall budgets). */
  category?: PlanningCategoryRefDto;
  progress: BudgetProgressDto;
}

export interface BudgetListDto {
  /** The reference date the periods were chosen for. */
  date: IsoDateString;
  budgets: BudgetWithProgressDto[];
}

/** Budgets of one cadence in one currency for the current period, without double counting. */
export interface BudgetPeriodTotalsDto {
  period: RecurringBudgetPeriod;
  from: IsoDateString;
  to: IsoDateString;
  budgetCount: number;
  /**
   * `overall`: an all-spending budget covers everything, so it alone gives the totals.
   * `categories`: the totals of category budgets that are not inside another one of them.
   */
  scope: 'overall' | 'categories';
  limitMinor: MinorUnitsString;
  spentMinor: MinorUnitsString;
  remainingMinor: MinorUnitsString;
  used: RatioDto;
}

export interface BudgetSummaryDto {
  date: IsoDateString;
  /** Absent when the user has no current budget at all. */
  currency?: CurrencyCode;
  /** Currencies with current budgets (requested or preferred first). */
  currencies: CurrencyCode[];
  /** Current budgets in `currency`, by status. */
  statusCounts: Record<BudgetProgressStatus, number>;
  /** One entry per cadence with current budgets in `currency` (custom budgets are not totalled). */
  totals: BudgetPeriodTotalsDto[];
  /** Up to four current budgets in `currency` that are furthest through their limit. */
  highlights: BudgetWithProgressDto[];
}

// --- Requests ------------------------------------------------------------------------------------

export interface CreateBudgetInput {
  name: string;
  description?: string;
  /** Omit for an overall budget (all expense categories). */
  categoryId?: EntityId;
  limitMinor: MinorUnitsString;
  currency: CurrencyCode;
  period: BudgetPeriod;
  startDate: IsoDateString;
  endDate?: IsoDateString;
  /** Defaults to `[8000]`; `[]` turns alerts off (the limit itself is always shown). */
  alertThresholdsBp?: number[];
}

/** Partial; `null` clears an optional field. */
export interface UpdateBudgetInput {
  name?: string;
  description?: string | null;
  categoryId?: EntityId | null;
  limitMinor?: MinorUnitsString;
  currency?: CurrencyCode;
  period?: BudgetPeriod;
  startDate?: IsoDateString;
  endDate?: IsoDateString | null;
  alertThresholdsBp?: number[];
}

export interface BudgetListQuery {
  status: BudgetStatusFilter;
  period?: BudgetPeriod;
  categoryId?: EntityId;
  currency?: CurrencyCode;
  /** Reference date for each budget's period; defaults to today in the user's time zone. */
  date?: IsoDateString;
}

export interface BudgetDetailQuery {
  date?: IsoDateString;
}

export interface BudgetSummaryQuery {
  date?: IsoDateString;
  currency?: CurrencyCode;
}
