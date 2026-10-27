import {
  calendarDateInTimeZone,
  currencyCodeSchema,
  minorUnitsToDecimalString,
  parseMinorUnits,
  type ApiErrorDetail,
  type CreateSavingsGoalInput,
  type GoalContributionInput,
  type SavingsGoalDetailDto,
  type SavingsGoalListDto,
  type SavingsGoalListQuery,
  type SavingsGoalWithProgressDto,
  type UpdateSavingsGoalInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { fromIsoDate } from '../../lib/calendar-dates';
import { goalStatus, toContributionDto, toGoalDto, toGoalProgressDto } from './goals.mapper';
import type { GoalRecord, GoalsRepository, GoalStateChange, GoalStore } from './goals.repository';

export type GoalAction = 'pause' | 'resume' | 'complete' | 'reopen' | 'archive' | 'restore';

export interface GoalsService {
  list: (caller: Caller, query: SavingsGoalListQuery) => Promise<SavingsGoalListDto>;
  get: (caller: Caller, goalId: string) => Promise<SavingsGoalDetailDto>;
  create: (caller: Caller, input: CreateSavingsGoalInput) => Promise<SavingsGoalDetailDto>;
  update: (
    caller: Caller,
    goalId: string,
    input: UpdateSavingsGoalInput,
  ) => Promise<SavingsGoalDetailDto>;
  contribute: (
    caller: Caller,
    goalId: string,
    input: GoalContributionInput,
  ) => Promise<SavingsGoalDetailDto>;
  act: (caller: Caller, goalId: string, action: GoalAction) => Promise<SavingsGoalDetailDto>;
}

export interface GoalsServiceDependencies {
  repository: GoalsRepository;
  now: () => Date;
}

const NONE = { savedMinor: 0n, count: 0 };

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That goal does not exist or is not yours.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message);
}

/** How each lifecycle action changes a goal; `undefined` when it already is in that state. */
function lifecycleChange(
  goal: GoalRecord,
  action: GoalAction,
  at: Date,
): GoalStateChange | undefined {
  const status = goalStatus(goal);
  if (status === 'archived' && action !== 'restore') {
    throw conflict('Restore this goal first.');
  }
  switch (action) {
    case 'pause':
      if (status === 'completed') throw conflict('This goal is completed. Reopen it first.');
      return goal.pausedAt === null ? { pausedAt: at } : undefined;
    case 'resume':
      return goal.pausedAt === null ? undefined : { pausedAt: null };
    case 'complete':
      return goal.completedAt === null ? { completedAt: at, pausedAt: null } : undefined;
    case 'reopen':
      return goal.completedAt === null ? undefined : { completedAt: null };
    case 'archive':
      return goal.archivedAt === null ? { archivedAt: at } : undefined;
    case 'restore':
      return goal.archivedAt === null ? undefined : { archivedAt: null };
  }
}

export function createGoalsService({ repository, now }: GoalsServiceDependencies): GoalsService {
  const todayFor = (caller: Caller): string => calendarDateInTimeZone(now(), caller.timeZone);

  const load = async (caller: Caller, goalId: string): Promise<SavingsGoalDetailDto> => {
    const goal = await repository.find(caller.userId, goalId);
    if (goal === null) {
      throw notFound();
    }
    const [totals, contributions] = await Promise.all([
      repository.savedTotals(caller.userId, [goal.id]),
      repository.contributions(caller.userId, goal.id),
    ]);
    const today = todayFor(caller);
    return {
      goal: toGoalDto(goal),
      progress: toGoalProgressDto(goal, totals.get(goal.id) ?? NONE, today),
      today,
      contributions: contributions.map(toContributionDto),
    };
  };

  const lockOne = async (store: GoalStore, caller: Caller, goalId: string): Promise<GoalRecord> => {
    const goal = await store.lock(caller.userId, goalId);
    if (goal === null) {
      throw notFound();
    }
    return goal;
  };

  return {
    list: async (caller, { status }) => {
      const goals = await repository.list(caller.userId, status);
      const totals = await repository.savedTotals(
        caller.userId,
        goals.map((goal) => goal.id),
      );
      const today = todayFor(caller);
      return {
        today,
        goals: goals.map((goal): SavingsGoalWithProgressDto => ({
          goal: toGoalDto(goal),
          progress: toGoalProgressDto(goal, totals.get(goal.id) ?? NONE, today),
        })),
      };
    },

    get: load,

    create: async (caller, input) => {
      const at = now();
      const goal = await repository.inGoalWrite(async (store) => {
        const created = await store.create(
          caller.userId,
          {
            name: input.name,
            description: input.description ?? null,
            targetMinor: parseMinorUnits(input.targetMinor),
            currency: input.currency,
            targetDate: input.targetDate === undefined ? null : fromIsoDate(input.targetDate),
          },
          at,
        );
        const initial =
          input.initialSavedMinor === undefined ? 0n : parseMinorUnits(input.initialSavedMinor);
        if (initial > 0n) {
          await store.addContribution(caller.userId, created.id, {
            amountMinor: initial,
            contributedOn: fromIsoDate(todayFor(caller)),
            note: 'Already set aside',
            createdAt: at,
          });
        }
        return created;
      });
      return load(caller, goal.id);
    },

    update: async (caller, goalId, input) => {
      await repository.inGoalWrite(async (store) => {
        const goal = await lockOne(store, caller, goalId);
        if (goal.archivedAt !== null) {
          throw conflict('Restore this goal before editing it.');
        }
        if (input.currency !== undefined && input.currency !== goal.currency) {
          // Allocations are amounts in the goal's currency; converting them would invent figures.
          if ((await store.saved(goal.id)).count > 0) {
            throw invalid([
              {
                path: 'body.currency',
                message: 'This goal already has money tracked in its currency, so it stays.',
              },
            ]);
          }
        }
        await store.update(goal.id, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.targetMinor === undefined
            ? {}
            : { targetMinor: parseMinorUnits(input.targetMinor) }),
          ...(input.currency === undefined ? {} : { currency: input.currency }),
          ...(input.targetDate === undefined
            ? {}
            : { targetDate: input.targetDate === null ? null : fromIsoDate(input.targetDate) }),
        });
      });
      return load(caller, goalId);
    },

    contribute: async (caller, goalId, input) => {
      const today = todayFor(caller);
      const contributedOn = input.contributedOn ?? today;
      if (contributedOn > today) {
        throw invalid([{ path: 'body.contributedOn', message: 'Choose today or an earlier day.' }]);
      }
      await repository.inGoalWrite(async (store) => {
        // Locked, so two allocations at once both count and a withdrawal sees the latest total.
        const goal = await lockOne(store, caller, goalId);
        const status = goalStatus(goal);
        if (status === 'completed' || status === 'archived') {
          throw conflict(
            status === 'completed'
              ? 'This goal is completed. Reopen it to change what is tracked.'
              : 'Restore this goal first.',
          );
        }
        const { savedMinor } = await store.saved(goal.id);
        let amountMinor: bigint;
        if (input.kind === 'set') {
          amountMinor = parseMinorUnits(input.savedMinor) - savedMinor;
          if (amountMinor === 0n) {
            throw invalid([
              { path: 'body.savedMinor', message: 'That is already the tracked amount.' },
            ]);
          }
        } else {
          const value = parseMinorUnits(input.amountMinor);
          amountMinor = input.kind === 'add' ? value : -value;
        }
        if (savedMinor + amountMinor < 0n) {
          throw invalid([
            {
              path: 'body.amountMinor',
              message: `Only ${minorUnitsToDecimalString(savedMinor, currencyCodeSchema.parse(goal.currency))} ${goal.currency} is tracked for this goal.`,
            },
          ]);
        }
        await store.addContribution(caller.userId, goal.id, {
          amountMinor,
          contributedOn: fromIsoDate(contributedOn),
          note: input.note ?? null,
          createdAt: now(),
        });
      });
      return load(caller, goalId);
    },

    act: async (caller, goalId, action) => {
      await repository.inGoalWrite(async (store) => {
        const goal = await lockOne(store, caller, goalId);
        const change = lifecycleChange(goal, action, now());
        if (change !== undefined) {
          await store.update(goal.id, change);
        }
      });
      return load(caller, goalId);
    },
  };
}
