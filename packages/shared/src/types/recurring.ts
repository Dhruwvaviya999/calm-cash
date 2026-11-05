import type { CurrencyCode } from '../constants/currencies';
import type { PaymentMethod } from '../constants/domain';
import type {
  OccurrenceStatus,
  RecurringFrequency,
  RecurringScheduleStatus,
  RecurringStatusFilter,
  RecurringType,
} from '../constants/planning';
import type { TransactionStatus } from '../constants/transactions';
import type { PlanningCategoryRefDto } from './budget';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';
import type { TransactionAccountRefDto, TransactionListItemDto } from './transaction';

/**
 * A rule describing expected income or spending (salary, rent, a subscription). It is a plan, not
 * money that moved: only confirming an occurrence records a real transaction.
 */
export interface RecurringScheduleDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  type: RecurringType;
  /** Expected amount per occurrence. */
  amountMinor: MinorUnitsString;
  currency: CurrencyCode;
  /** Account the money usually moves through; can be chosen when recording instead. */
  accountId?: EntityId;
  categoryId?: EntityId;
  /** Payee of an expense or payer of income (for subscriptions: the provider). */
  merchant?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  frequency: RecurringFrequency;
  interval: number;
  /** The first occurrence; later ones follow its weekday or day of the month. */
  startDate: IsoDateString;
  /** No occurrence after this date. */
  endDate?: IsoDateString;
  /** Days before the due date from which the app highlights it. */
  reminderDays?: number;
  status: RecurringScheduleStatus;
  /** The earliest occurrence still expected (absent when none is left). */
  nextOccurrenceDate?: IsoDateString;
  isSubscription: boolean;
  pausedAt?: IsoDateTimeString;
  /** Subscriptions: when the person marked it cancelled (`endDate` is then set). */
  cancelledAt?: IsoDateTimeString;
  archivedAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** One expected (or resolved) instance of a schedule, identified by schedule and scheduled date. */
export interface OccurrenceDto {
  scheduleId: EntityId;
  /** The date the rule puts it on: its stable identity within the schedule. */
  scheduledDate: IsoDateString;
  /** When it is expected; later than `scheduledDate` once postponed. */
  dueDate: IsoDateString;
  status: OccurrenceStatus;
  postponed: boolean;
  /** Within the schedule's reminder window (pending occurrences only). */
  dueSoon: boolean;
  /** Expected amount, or the recorded transaction's amount. */
  amountMinor: MinorUnitsString;
  currency: CurrencyCode;
  /** Recorded occurrences: the real transaction. */
  transactionId?: EntityId;
  transactionStatus?: TransactionStatus;
  /** When it was recorded, skipped, or passed over while paused. */
  resolvedAt?: IsoDateTimeString;
}

export interface RecurringScheduleItemDto {
  schedule: RecurringScheduleDto;
  account?: TransactionAccountRefDto;
  category?: PlanningCategoryRefDto;
  /** The earliest occurrence still expected, with its status today. */
  nextOccurrence?: OccurrenceDto;
}

export interface RecurringScheduleListDto {
  today: IsoDateString;
  schedules: RecurringScheduleItemDto[];
}

export interface RecurringScheduleDetailDto extends RecurringScheduleItemDto {
  today: IsoDateString;
  /** Pending occurrences, overdue first, then the next ones (up to six). */
  upcoming: OccurrenceDto[];
  /** Recorded, skipped, and paused occurrences, newest first (up to 24). */
  history: OccurrenceDto[];
}

export interface UpcomingOccurrenceDto {
  occurrence: OccurrenceDto;
  schedule: RecurringScheduleDto;
  account?: TransactionAccountRefDto;
  category?: PlanningCategoryRefDto;
}

/** Expected amounts per currency: plans, not money that moved. Never added across currencies. */
export interface ExpectedTotalsDto {
  currency: CurrencyCode;
  expectedIncomeMinor: MinorUnitsString;
  expectedExpenseMinor: MinorUnitsString;
  incomeCount: number;
  expenseCount: number;
}

export interface UpcomingOccurrencesDto {
  today: IsoDateString;
  from: IsoDateString;
  to: IsoDateString;
  /** Overdue occurrences (before `from` as well), then every occurrence due from `from` to `to`. */
  items: UpcomingOccurrenceDto[];
  /** Pending occurrences only (upcoming, due, overdue), per currency. */
  pendingTotals: ExpectedTotalsDto[];
  overdueCount: number;
  /** True when more occurrences matched than one response returns. */
  truncated: boolean;
}

/** The result of recording an occurrence: the real transaction and the schedule moved on. */
export interface RecordedOccurrenceDto {
  occurrence: OccurrenceDto;
  transaction: TransactionListItemDto;
  schedule: RecurringScheduleItemDto;
}

export interface OccurrenceActionResultDto {
  occurrence: OccurrenceDto;
  schedule: RecurringScheduleItemDto;
}

// --- Requests ------------------------------------------------------------------------------------

export interface CreateRecurringScheduleInput {
  name: string;
  type: RecurringType;
  amountMinor: MinorUnitsString;
  /** Required without an account; with one, it must match the account's currency. */
  currency?: CurrencyCode;
  accountId?: EntityId;
  categoryId?: EntityId;
  merchant?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  frequency: RecurringFrequency;
  /** Defaults to 1. */
  interval?: number;
  startDate: IsoDateString;
  endDate?: IsoDateString;
  reminderDays?: number;
}

/**
 * Partial; `null` clears an optional field. Amount, account, category, and texts apply to every
 * occurrence not yet recorded; recorded transactions never change. Timing changes (`frequency`,
 * `interval`, `startDate`) restart the schedule from the new start date, which must come after
 * every recorded or skipped occurrence.
 */
export interface UpdateRecurringScheduleInput {
  name?: string;
  amountMinor?: MinorUnitsString;
  currency?: CurrencyCode;
  accountId?: EntityId | null;
  categoryId?: EntityId | null;
  merchant?: string | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string | null;
  frequency?: RecurringFrequency;
  interval?: number;
  startDate?: IsoDateString;
  endDate?: IsoDateString | null;
  reminderDays?: number | null;
}

export interface RecurringListQuery {
  status: RecurringStatusFilter;
  type?: RecurringType;
  /** `true`: subscriptions only; `false`: everything else. */
  subscription?: boolean;
}

export interface UpcomingOccurrencesQuery {
  /** Defaults to today in the user's time zone. */
  from?: IsoDateString;
  /** Defaults to 30 days after `from`. */
  to?: IsoDateString;
  type?: RecurringType;
  subscription?: boolean;
}

/** Records the real transaction; every field defaults to the schedule's. */
export interface RecordOccurrenceInput {
  accountId?: EntityId;
  amountMinor?: MinorUnitsString;
  /** Defaults to now. Cannot be in the future. */
  occurredAt?: IsoDateTimeString;
  categoryId?: EntityId;
  description?: string;
  merchant?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  tags?: string[];
}

/**
 * Settles an occurrence with a transaction the person already recorded (e.g. an imported bank
 * payment), instead of recording a second one. The transaction must be theirs, active, of the
 * schedule's type and currency, near the due date, and not settle another occurrence.
 */
export interface LinkOccurrenceInput {
  transactionId: EntityId;
}

/** Transactions that could settle an occurrence, closest match first. */
export interface OccurrenceLinkCandidatesDto {
  candidates: TransactionListItemDto[];
}

export interface PostponeOccurrenceInput {
  dueDate: IsoDateString;
}

export interface EndRecurringScheduleInput {
  /** The last date occurrences may fall on; defaults to today. */
  endDate?: IsoDateString;
}
