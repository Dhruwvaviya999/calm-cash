import type { CurrencyCode } from '../constants/currencies';
import type { RecurringStatusFilter, SubscriptionStatus } from '../constants/planning';
import type { IsoDateString, MinorUnitsString } from './common';
import type {
  CreateRecurringScheduleInput,
  RecurringScheduleItemDto,
  UpdateRecurringScheduleInput,
} from './recurring';

/**
 * A forecast: the schedule's amount times the number of occurrences it has in the window. It is
 * an estimate of what will be charged, never an amount already spent.
 */
export interface CostEstimateDto {
  from: IsoDateString;
  to: IsoDateString;
  occurrences: number;
  amountMinor: MinorUnitsString;
}

/** A subscription is a recurring expense schedule marked as one; recurrence lives there. */
export interface SubscriptionDto extends RecurringScheduleItemDto {
  status: SubscriptionStatus;
  /** Estimated charges from today over the next twelve months. */
  nextTwelveMonths: CostEstimateDto;
}

export interface SubscriptionListDto {
  today: IsoDateString;
  subscriptions: SubscriptionDto[];
}

export interface SubscriptionCurrencySummaryDto {
  currency: CurrencyCode;
  /** Active (not paused, cancelled, or archived) subscriptions. */
  activeCount: number;
  /** Expected charges that are past due and not recorded or skipped. */
  overdueCount: number;
  overdueMinor: MinorUnitsString;
  next30Days: CostEstimateDto;
  next12Months: CostEstimateDto;
}

/** Estimates per currency; amounts are never added across currencies. */
export interface SubscriptionSummaryDto {
  today: IsoDateString;
  currencies: SubscriptionCurrencySummaryDto[];
}

// --- Requests ------------------------------------------------------------------------------------

/** Subscriptions are always expenses. */
export type CreateSubscriptionInput = Omit<CreateRecurringScheduleInput, 'type'>;

export type UpdateSubscriptionInput = UpdateRecurringScheduleInput;

export interface CancelSubscriptionInput {
  /** Last date a charge is expected; defaults to today. Earlier expected charges stay. */
  effectiveDate?: IsoDateString;
}

export interface SubscriptionListQuery {
  status: RecurringStatusFilter;
}
