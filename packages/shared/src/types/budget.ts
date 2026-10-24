import type { CurrencyCode } from '../constants/currencies';
import type { BudgetPeriod } from '../constants/domain';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';

export interface BudgetDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  /** Absent when the budget covers all expense categories. */
  categoryId?: EntityId;
  /** Positive spending limit per period. */
  limitMinor: MinorUnitsString;
  currency: CurrencyCode;
  period: BudgetPeriod;
  /** First day of the budget (inclusive), in the user's time zone. */
  startDate: IsoDateString;
  /** Last day of the budget (inclusive). Required when `period` is `custom`. */
  endDate?: IsoDateString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
