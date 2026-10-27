import type { CurrencyCode } from '../constants/currencies';
import type { SavingsGoalStatus, SavingsGoalStatusFilter } from '../constants/planning';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';
import type { RatioDto } from './dashboard';

/**
 * Something the person is saving towards. Its progress is the sum of the allocations they log: a
 * planning figure that never changes an account balance and is not the dashboard's savings rate.
 */
export interface SavingsGoalDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  description?: string;
  /** Positive target amount. */
  targetMinor: MinorUnitsString;
  currency: CurrencyCode;
  targetDate?: IsoDateString;
  status: SavingsGoalStatus;
  pausedAt?: IsoDateTimeString;
  completedAt?: IsoDateTimeString;
  archivedAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface GoalProgressDto {
  /** Sum of all allocations (never negative). */
  savedMinor: MinorUnitsString;
  /** Target − saved; negative once the target is exceeded. */
  remainingMinor: MinorUnitsString;
  /** Saved ÷ target in basis points, uncapped; unavailable (`no_target`) without a target. */
  percent: RatioDto;
  /** Saved ≥ target. Independent of `status`: the person marks a goal completed themselves. */
  reached: boolean;
  /** Present with a target date; negative once it has passed. */
  daysRemaining?: number;
  /** Present while the target date is ahead and money is still needed. */
  monthlyNeededMinor?: MinorUnitsString;
  contributionCount: number;
}

export interface SavingsGoalWithProgressDto {
  goal: SavingsGoalDto;
  progress: GoalProgressDto;
}

export interface SavingsGoalListDto {
  today: IsoDateString;
  goals: SavingsGoalWithProgressDto[];
}

/** A planning allocation: money set aside (positive) or taken back (negative). */
export interface GoalContributionDto {
  id: EntityId;
  goalId: EntityId;
  amountMinor: MinorUnitsString;
  /** The day it applies to, in the user's time zone. */
  contributedOn: IsoDateString;
  note?: string;
  createdAt: IsoDateTimeString;
}

export interface SavingsGoalDetailDto extends SavingsGoalWithProgressDto {
  today: IsoDateString;
  /** Newest first, up to 50. */
  contributions: GoalContributionDto[];
}

// --- Requests ------------------------------------------------------------------------------------

export interface CreateSavingsGoalInput {
  name: string;
  description?: string;
  targetMinor: MinorUnitsString;
  currency: CurrencyCode;
  targetDate?: IsoDateString;
  /** Already set aside; recorded as the first allocation. */
  initialSavedMinor?: MinorUnitsString;
}

/** Partial; `null` clears an optional field. The currency is fixed once allocations exist. */
export interface UpdateSavingsGoalInput {
  name?: string;
  description?: string | null;
  targetMinor?: MinorUnitsString;
  currency?: CurrencyCode;
  targetDate?: IsoDateString | null;
}

export type GoalContributionInput =
  | {
      kind: 'add' | 'withdraw';
      /** Positive; `withdraw` takes it back. */
      amountMinor: MinorUnitsString;
      contributedOn?: IsoDateString;
      note?: string;
    }
  | {
      kind: 'set';
      /** The new tracked total; the API records the difference. */
      savedMinor: MinorUnitsString;
      contributedOn?: IsoDateString;
      note?: string;
    };

export interface SavingsGoalListQuery {
  status: SavingsGoalStatusFilter;
}
