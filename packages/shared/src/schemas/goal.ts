import { z } from 'zod';

import { TEXT_LIMITS } from '../constants/domain';
import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import { SAVINGS_GOAL_STATUS_FILTERS, SAVINGS_GOAL_STATUSES } from '../constants/planning';
import { tryParseMinorUnits } from '../money/minor-units';
import type {
  CreateSavingsGoalInput,
  GoalContributionDto,
  GoalContributionInput,
  GoalProgressDto,
  SavingsGoalDetailDto,
  SavingsGoalDto,
  SavingsGoalListDto,
  SavingsGoalListQuery,
  SavingsGoalWithProgressDto,
  UpdateSavingsGoalInput,
} from '../types/goal';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
  singleLineTextSchema,
} from './common';
import { ratioDtoSchema } from './dashboard';

export const savingsGoalStatusSchema = z.enum(SAVINGS_GOAL_STATUSES);
export const savingsGoalStatusFilterSchema = z.enum(SAVINGS_GOAL_STATUS_FILTERS);

// --- Fields --------------------------------------------------------------------------------------

export const goalNameSchema = singleLineTextSchema(
  TEXT_LIMITS.goalName,
  'Give this goal a name, e.g. "Emergency fund".',
);

const goalDescriptionSchema = singleLineTextSchema(
  TEXT_LIMITS.goalDescription,
  'Enter a description, or leave it empty.',
);

const goalNoteSchema = singleLineTextSchema(
  TEXT_LIMITS.goalContributionNote,
  'Enter a note, or leave it empty.',
);

function enteredAmount(min: bigint, message: string): z.ZodType<string> {
  return z.string({ error: 'Enter an amount.' }).refine(
    (value) => {
      const parsed = tryParseMinorUnits(value);
      return parsed !== undefined && parsed >= min && parsed <= MAX_ENTERED_AMOUNT_MINOR;
    },
    { error: message },
  );
}

const targetMinorSchema = enteredAmount(1n, 'Enter a target above zero, in minor units.');
const positiveAmountSchema = enteredAmount(1n, 'Enter an amount above zero, in minor units.');
const savedTotalSchema = enteredAmount(0n, 'Enter zero or more, in minor units.');

const goalDateSchema = isoDateSchema.refine((value) => value >= '1900-01-01', {
  error: 'Choose a date after 1900.',
});

// --- Requests ------------------------------------------------------------------------------------

export const createSavingsGoalInputSchema = z.strictObject({
  name: goalNameSchema,
  description: goalDescriptionSchema.exactOptional(),
  targetMinor: targetMinorSchema,
  currency: currencyCodeSchema,
  targetDate: goalDateSchema.exactOptional(),
  initialSavedMinor: savedTotalSchema.exactOptional(),
}) satisfies z.ZodType<CreateSavingsGoalInput>;

export const updateSavingsGoalInputSchema = z
  .strictObject({
    name: goalNameSchema.exactOptional(),
    description: goalDescriptionSchema.nullable().exactOptional(),
    targetMinor: targetMinorSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
    targetDate: goalDateSchema.nullable().exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateSavingsGoalInput>;

export const goalContributionInputSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.enum(['add', 'withdraw']),
      amountMinor: positiveAmountSchema,
      contributedOn: goalDateSchema.exactOptional(),
      note: goalNoteSchema.exactOptional(),
    }),
    z.strictObject({
      kind: z.literal('set'),
      savedMinor: savedTotalSchema,
      contributedOn: goalDateSchema.exactOptional(),
      note: goalNoteSchema.exactOptional(),
    }),
  ],
  { error: 'Choose whether to add, withdraw, or set the amount.' },
) satisfies z.ZodType<GoalContributionInput>;

export const savingsGoalListQuerySchema = z.strictObject({
  status: savingsGoalStatusFilterSchema.default('current'),
}) satisfies z.ZodType<SavingsGoalListQuery>;

// --- Responses -----------------------------------------------------------------------------------

export const savingsGoalDtoSchema = z.object({
  id: entityIdSchema,
  userId: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.goalName),
  description: z.string().min(1).max(TEXT_LIMITS.goalDescription).exactOptional(),
  targetMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  targetDate: isoDateSchema.exactOptional(),
  status: savingsGoalStatusSchema,
  pausedAt: isoDateTimeSchema.exactOptional(),
  completedAt: isoDateTimeSchema.exactOptional(),
  archivedAt: isoDateTimeSchema.exactOptional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<SavingsGoalDto>;

export const goalProgressDtoSchema = z.object({
  savedMinor: minorUnitsSchema,
  remainingMinor: minorUnitsSchema,
  percent: ratioDtoSchema,
  reached: z.boolean(),
  daysRemaining: z.number().int().exactOptional(),
  monthlyNeededMinor: positiveMinorUnitsSchema.exactOptional(),
  contributionCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<GoalProgressDto>;

export const savingsGoalWithProgressDtoSchema = z.object({
  goal: savingsGoalDtoSchema,
  progress: goalProgressDtoSchema,
}) satisfies z.ZodType<SavingsGoalWithProgressDto>;

export const savingsGoalListDtoSchema = z.object({
  today: isoDateSchema,
  goals: z.array(savingsGoalWithProgressDtoSchema),
}) satisfies z.ZodType<SavingsGoalListDto>;

export const goalContributionDtoSchema = z.object({
  id: entityIdSchema,
  goalId: entityIdSchema,
  amountMinor: minorUnitsSchema.refine((value) => value !== '0'),
  contributedOn: isoDateSchema,
  note: z.string().min(1).max(TEXT_LIMITS.goalContributionNote).exactOptional(),
  createdAt: isoDateTimeSchema,
}) satisfies z.ZodType<GoalContributionDto>;

export const savingsGoalDetailDtoSchema = z.object({
  goal: savingsGoalDtoSchema,
  progress: goalProgressDtoSchema,
  today: isoDateSchema,
  contributions: z.array(goalContributionDtoSchema),
}) satisfies z.ZodType<SavingsGoalDetailDto>;
