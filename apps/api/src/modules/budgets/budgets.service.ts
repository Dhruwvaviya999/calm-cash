import {
  calendarDateInTimeZone,
  createBudgetInputSchema,
  DEFAULT_BUDGET_ALERT_THRESHOLDS_BP,
  parseMinorUnits,
  type ApiErrorDetail,
  type BudgetDetailQuery,
  type BudgetListDto,
  type BudgetListQuery,
  type BudgetSummaryDto,
  type BudgetSummaryQuery,
  type BudgetWithProgressDto,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { fromIsoDate, toIsoDate } from '../../lib/calendar-dates';
import { budgetCurrencies, summarize, toProgressDto, windowOf } from './budget-metrics';
import { toPlanningCategoryRef } from '../categories';
import { toBudgetDto } from './budgets.mapper';
import type {
  BudgetRecord,
  BudgetsRepository,
  BudgetWithCategory,
  BudgetWrite,
  BudgetWriteStore,
} from './budgets.repository';

export interface BudgetsService {
  list: (caller: Caller, query: BudgetListQuery) => Promise<BudgetListDto>;
  summary: (caller: Caller, query: BudgetSummaryQuery) => Promise<BudgetSummaryDto>;
  get: (
    caller: Caller,
    budgetId: string,
    query: BudgetDetailQuery,
  ) => Promise<BudgetWithProgressDto>;
  create: (caller: Caller, input: CreateBudgetInput) => Promise<BudgetWithProgressDto>;
  update: (
    caller: Caller,
    budgetId: string,
    input: UpdateBudgetInput,
  ) => Promise<BudgetWithProgressDto>;
  archive: (caller: Caller, budgetId: string) => Promise<BudgetWithProgressDto>;
  restore: (caller: Caller, budgetId: string) => Promise<BudgetWithProgressDto>;
}

export interface BudgetsServiceDependencies {
  repository: BudgetsRepository;
  now: () => Date;
}

const ZERO = { totalMinor: 0n, count: 0 };

// The same answer for "does not exist" and "belongs to someone else", so IDs reveal nothing.
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That budget does not exist or is not yours.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

const PERIOD_NAMES: Readonly<Record<BudgetRecord['period'], string>> = {
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'yearly',
  custom: 'custom',
};

function toWrite(input: CreateBudgetInput): BudgetWrite {
  return {
    name: input.name,
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    limitMinor: parseMinorUnits(input.limitMinor),
    currency: input.currency,
    period: input.period,
    startDate: fromIsoDate(input.startDate),
    endDate: input.endDate === undefined ? null : fromIsoDate(input.endDate),
    alertThresholdsBp: [...(input.alertThresholdsBp ?? DEFAULT_BUDGET_ALERT_THRESHOLDS_BP)],
  };
}

/** The stored budget as a complete create request, so an edit is validated as a whole. */
function mergeUpdate(current: BudgetRecord, patch: UpdateBudgetInput): Record<string, unknown> {
  const description = patch.description === undefined ? current.description : patch.description;
  const categoryId = patch.categoryId === undefined ? current.categoryId : patch.categoryId;
  const endDate =
    patch.endDate === undefined
      ? current.endDate === null
        ? null
        : toIsoDate(current.endDate)
      : patch.endDate;
  return {
    name: patch.name ?? current.name,
    ...(description === null ? {} : { description }),
    ...(categoryId === null ? {} : { categoryId }),
    limitMinor: patch.limitMinor ?? current.limitMinor.toString(),
    currency: patch.currency ?? current.currency,
    period: patch.period ?? current.period,
    startDate: patch.startDate ?? toIsoDate(current.startDate),
    ...(endDate === null ? {} : { endDate }),
    alertThresholdsBp: patch.alertThresholdsBp ?? [...current.alertThresholdsBp],
  };
}

export function createBudgetsService({
  repository,
  now,
}: BudgetsServiceDependencies): BudgetsService {
  const todayFor = (caller: Caller): string => calendarDateInTimeZone(now(), caller.timeZone);

  /** Progress for every budget from one aggregate query. */
  const withProgress = async (
    caller: Caller,
    rows: readonly BudgetWithCategory[],
    referenceDate: string,
  ): Promise<BudgetWithProgressDto[]> => {
    const windows = rows.map((row) => windowOf(row, referenceDate, caller.timeZone));
    const spending = await repository.spending(
      caller.userId,
      windows.map((entry) => entry.spending),
    );
    return rows.map((row, index) => {
      const window = windows[index]?.window;
      if (window === undefined) {
        throw new Error('Budget window missing.');
      }
      return {
        budget: toBudgetDto(row),
        ...(row.category === null ? {} : { category: toPlanningCategoryRef(row.category) }),
        progress: toProgressDto(row, window, spending.get(row.id) ?? ZERO),
      };
    });
  };

  const load = async (
    caller: Caller,
    budgetId: string,
    referenceDate: string,
  ): Promise<BudgetWithProgressDto> => {
    const row = await repository.find(caller.userId, budgetId);
    if (row === null) {
      throw notFound();
    }
    const [item] = await withProgress(caller, [row], referenceDate);
    if (item === undefined) {
      throw notFound();
    }
    return item;
  };

  /** Budgets track spending: an expense category of the user's, active unless already in use. */
  const checkCategory = async (
    caller: Caller,
    categoryId: string | null,
    keepId: string | null,
  ): Promise<void> => {
    if (categoryId === null) {
      return;
    }
    const category = await repository.findCategory(caller.userId, categoryId);
    if (category === null) {
      throw invalid([{ path: 'body.categoryId', message: 'Choose one of your categories.' }]);
    }
    if (category.kind !== 'expense') {
      throw invalid([
        {
          path: 'body.categoryId',
          message: 'Budgets limit spending, so choose an expense category.',
        },
      ]);
    }
    if (category.archivedAt !== null && category.id !== keepId) {
      throw invalid([
        {
          path: 'body.categoryId',
          message: `“${category.name}” is archived. Choose an active category.`,
        },
      ]);
    }
  };

  /** One active budget per scope, currency, and period for any given day. */
  const assertNoOverlap = async (
    store: BudgetWriteStore,
    caller: Caller,
    write: BudgetWrite,
    exceptId: string | undefined,
  ): Promise<void> => {
    const clash = await store.overlapping(caller.userId, write, exceptId);
    if (clash.length > 0) {
      throw new AppError(
        409,
        'CONFLICT',
        `“${clash[0]?.name ?? 'Another budget'}” is already a ${PERIOD_NAMES[write.period]} budget for the same spending in ${write.currency} on these dates. Edit or archive it instead, so the same spending is never budgeted twice.`,
      );
    }
  };

  const lockOne = async (
    store: BudgetWriteStore,
    caller: Caller,
    budgetId: string,
  ): Promise<BudgetRecord> => {
    const record = await store.lock(caller.userId, budgetId);
    if (record === null) {
      throw notFound();
    }
    return record;
  };

  return {
    list: async (caller, { date, ...filter }) => {
      const referenceDate = date ?? todayFor(caller);
      const rows = await repository.list(caller.userId, filter);
      return { date: referenceDate, budgets: await withProgress(caller, rows, referenceDate) };
    },

    summary: async (caller, { date, currency: requested }) => {
      const referenceDate = date ?? todayFor(caller);
      const rows = await repository.list(caller.userId, { status: 'active' });
      const items = await withProgress(caller, rows, referenceDate);
      const currencies = budgetCurrencies(items, requested ?? caller.preferredCurrency);
      const currency =
        requested !== undefined && currencies.includes(requested) ? requested : currencies[0];
      return {
        date: referenceDate,
        ...(currency === undefined ? {} : { currency }),
        currencies,
        ...summarize(items, currency, referenceDate),
      };
    },

    get: (caller, budgetId, { date }) => load(caller, budgetId, date ?? todayFor(caller)),

    create: async (caller, input) => {
      const write = toWrite(input);
      await checkCategory(caller, write.categoryId, null);
      const created = await repository.inBudgetWrite(caller.userId, async (store) => {
        await assertNoOverlap(store, caller, write, undefined);
        return store.create(caller.userId, write, now());
      });
      return load(caller, created.id, todayFor(caller));
    },

    update: async (caller, budgetId, patch) => {
      await repository.inBudgetWrite(caller.userId, async (store) => {
        const current = await lockOne(store, caller, budgetId);
        if (current.archivedAt !== null) {
          throw new AppError(409, 'CONFLICT', 'Restore this budget before editing it.');
        }
        const parsed = createBudgetInputSchema.safeParse(mergeUpdate(current, patch));
        if (!parsed.success) {
          throw invalid(
            parsed.error.issues.map((issue) => ({
              path: ['body', ...issue.path.map(String)].join('.'),
              message: issue.message,
            })),
          );
        }
        const write = toWrite(parsed.data);
        await checkCategory(caller, write.categoryId, current.categoryId);
        await assertNoOverlap(store, caller, write, current.id);
        await store.update(current.id, write);
      });
      return load(caller, budgetId, todayFor(caller));
    },

    archive: async (caller, budgetId) => {
      await repository.inBudgetWrite(caller.userId, async (store) => {
        const current = await lockOne(store, caller, budgetId);
        // Already archived: nothing changes, so repeating the request is harmless.
        if (current.archivedAt === null) {
          await store.setArchived(current.id, now());
        }
      });
      return load(caller, budgetId, todayFor(caller));
    },

    restore: async (caller, budgetId) => {
      await repository.inBudgetWrite(caller.userId, async (store) => {
        const current = await lockOne(store, caller, budgetId);
        if (current.archivedAt !== null) {
          await assertNoOverlap(store, caller, current, current.id);
          await store.setArchived(current.id, null);
        }
      });
      return load(caller, budgetId, todayFor(caller));
    },
  };
}
