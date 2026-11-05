import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  createRecurringScheduleInputSchema,
  currencyCodeSchema,
  daysBetween,
  DEFAULT_UPCOMING_DAYS,
  isOccurrenceDate,
  MAX_OCCURRENCE_LINK_CANDIDATES,
  MAX_POSTPONE_DAYS,
  MAX_UPCOMING_OCCURRENCES,
  MAX_UPCOMING_RANGE_DAYS,
  OCCURRENCE_ACTION_HORIZON_DAYS,
  OCCURRENCE_LINK_WINDOW_DAYS,
  occurrencesBetween,
  parseMinorUnits,
  serializeMinorUnits,
  type ApiErrorDetail,
  type CreateRecurringScheduleInput,
  type CreateTransactionInput,
  type CurrencyCode,
  type EndRecurringScheduleInput,
  type ExpectedTotalsDto,
  type IsoDateString,
  type LinkOccurrenceInput,
  type OccurrenceActionResultDto,
  type OccurrenceDto,
  type OccurrenceLinkCandidatesDto,
  type PostponeOccurrenceInput,
  type RecordedOccurrenceDto,
  type RecordOccurrenceInput,
  type RecurringListQuery,
  type RecurringScheduleDetailDto,
  type RecurringScheduleItemDto,
  type RecurringScheduleListDto,
  type UpcomingOccurrenceDto,
  type UpcomingOccurrencesDto,
  type UpcomingOccurrencesQuery,
  type UpdateRecurringScheduleInput,
} from '@calmcash/shared';

import type { Transaction } from '../../generated/prisma/client';
import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { fromIsoDate, toIsoDate } from '../../lib/calendar-dates';
import { toPlanningCategoryRef } from '../categories';
import type { TransactionsService } from '../transactions';
import {
  isResolved,
  nextCursor,
  pendingOccurrences,
  rowsByDate,
  ruleOf,
  scheduleStatus,
  toOccurrenceDto,
} from './recurring-engine';
import { toAccountRef, toScheduleDto, toScheduleItemDto } from './recurring.mapper';
import type {
  OccurrenceRecord,
  RecurringRepository,
  ScheduleRecord,
  ScheduleStore,
  ScheduleWithRefs,
  ScheduleWrite,
} from './recurring.repository';

export interface OccurrenceAddress {
  scheduleId: string;
  /** The scheduled date (the occurrence's identity), not a postponed due date. */
  date: IsoDateString;
}

export interface RecordOutcome {
  result: RecordedOccurrenceDto;
  /** True when an earlier request already recorded this occurrence. */
  replayed: boolean;
}

/** Options only other API modules (subscriptions) use. */
export interface CreateScheduleOptions {
  isSubscription: boolean;
}

export interface CollectOptions {
  from: IsoDateString;
  to: IsoDateString;
  type?: CreateRecurringScheduleInput['type'] | undefined;
  subscription?: boolean | undefined;
  limit: number;
}

export interface RecurringService {
  /** Today in the caller's time zone, by the service's clock. */
  today: (caller: Caller) => IsoDateString;
  list: (caller: Caller, query: RecurringListQuery) => Promise<RecurringScheduleListDto>;
  get: (caller: Caller, scheduleId: string) => Promise<RecurringScheduleDetailDto>;
  create: (
    caller: Caller,
    input: CreateRecurringScheduleInput,
    options?: CreateScheduleOptions,
  ) => Promise<RecurringScheduleItemDto>;
  update: (
    caller: Caller,
    scheduleId: string,
    input: UpdateRecurringScheduleInput,
  ) => Promise<RecurringScheduleItemDto>;
  pause: (caller: Caller, scheduleId: string) => Promise<RecurringScheduleItemDto>;
  resume: (caller: Caller, scheduleId: string) => Promise<RecurringScheduleItemDto>;
  end: (
    caller: Caller,
    scheduleId: string,
    input: EndRecurringScheduleInput,
    options?: { cancel: boolean },
  ) => Promise<RecurringScheduleItemDto>;
  archive: (caller: Caller, scheduleId: string) => Promise<RecurringScheduleItemDto>;
  restore: (caller: Caller, scheduleId: string) => Promise<RecurringScheduleItemDto>;
  upcoming: (caller: Caller, query: UpcomingOccurrencesQuery) => Promise<UpcomingOccurrencesDto>;
  /** Like `upcoming` with an explicit range and size, for forecasts (subscriptions). */
  collect: (caller: Caller, options: CollectOptions) => Promise<UpcomingOccurrencesDto>;
  /**
   * One occurrence as it stands today, read-only (reminders re-check it before they go out);
   * `undefined` when the schedule is not the caller's or the date is not, or no longer, one of
   * its occurrences.
   */
  occurrence: (
    caller: Caller,
    address: OccurrenceAddress,
  ) => Promise<OccurrenceActionResultDto | undefined>;
  record: (
    caller: Caller,
    address: OccurrenceAddress,
    input: RecordOccurrenceInput,
  ) => Promise<RecordOutcome>;
  skip: (caller: Caller, address: OccurrenceAddress) => Promise<OccurrenceActionResultDto>;
  unskip: (caller: Caller, address: OccurrenceAddress) => Promise<OccurrenceActionResultDto>;
  postpone: (
    caller: Caller,
    address: OccurrenceAddress,
    input: PostponeOccurrenceInput,
  ) => Promise<OccurrenceActionResultDto>;
  /**
   * Settles the occurrence with a transaction the person already recorded (an ordinary entry or an
   * imported statement row) instead of recording a second one. Moves no money.
   */
  link: (
    caller: Caller,
    address: OccurrenceAddress,
    input: LinkOccurrenceInput,
  ) => Promise<RecordOutcome>;
  /** Transactions that could settle the occurrence, closest amount and date first. */
  linkCandidates: (
    caller: Caller,
    address: OccurrenceAddress,
  ) => Promise<OccurrenceLinkCandidatesDto>;
}

export interface RecurringServiceDependencies {
  repository: RecurringRepository;
  /** Records the real transaction of a confirmed occurrence (the transactions module's ledger). */
  transactions: Pick<TransactionsService, 'recordLinked' | 'get'>;
  now: () => Date;
}

const UPCOMING_IN_DETAIL = 6;
const NO_ROWS: ReadonlyMap<IsoDateString, OccurrenceRecord> = new Map();
const HISTORY_IN_DETAIL = 24;
/** Upper bound of occurrences passed over during one pause (about ten years of weekly ones). */
const MAX_PAUSED_OCCURRENCES = 600;

// The same answer for "does not exist" and "belongs to someone else", so IDs reveal nothing.
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That recurring payment does not exist or is not yours.');

const occurrenceNotFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That date is not one of this schedule’s payments.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message);
}

/** The local dates an existing transaction may fall on to settle an occurrence. */
function linkWindow(
  scheduledDate: IsoDateString,
  dueDate: IsoDateString,
): { from: IsoDateString; to: IsoDateString } {
  return {
    from: addDaysToIsoDate(scheduledDate, -OCCURRENCE_LINK_WINDOW_DAYS),
    to: addDaysToIsoDate(dueDate, OCCURRENCE_LINK_WINDOW_DAYS),
  };
}

/** Why `transaction` cannot settle an occurrence of `schedule` (empty when it can). */
function linkProblems(
  schedule: Pick<ScheduleRecord, 'type' | 'currency'>,
  transaction: Transaction,
  occurredOn: IsoDateString,
  window: { from: IsoDateString; to: IsoDateString },
): string[] {
  const problems: string[] = [];
  if (transaction.voidedAt !== null) {
    problems.push('This transaction is voided. Choose an active one.');
  }
  if (transaction.type !== schedule.type) {
    problems.push(
      schedule.type === 'income' ? 'Choose an income transaction.' : 'Choose an expense.',
    );
  }
  if (transaction.currency !== schedule.currency) {
    problems.push(`Choose a transaction in ${schedule.currency}.`);
  }
  if (occurredOn < window.from || occurredOn > window.to) {
    problems.push(
      `Choose a transaction within ${String(OCCURRENCE_LINK_WINDOW_DAYS)} days of this payment.`,
    );
  }
  return problems;
}

/** A stored currency code as a supported one (`undefined` for anything else). */
function currencyOf(value: string): CurrencyCode | undefined {
  const parsed = currencyCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function timingOf(schedule: Pick<ScheduleRecord, 'frequency' | 'interval' | 'startDate'>): string {
  return `${schedule.frequency}/${String(schedule.interval)}/${toIsoDate(schedule.startDate)}`;
}

/** The latest scheduled date that already has a final outcome (recorded, skipped, or paused). */
function lastResolvedDate(rows: readonly OccurrenceRecord[]): IsoDateString | undefined {
  return rows
    .filter((row) => isResolved(row))
    .map((row) => toIsoDate(row.scheduledDate))
    .sort()
    .at(-1);
}

/** The stored schedule as a complete create request, so an edit is validated as a whole. */
function mergeUpdate(
  current: ScheduleRecord,
  patch: UpdateRecurringScheduleInput,
): Record<string, unknown> {
  const pick = <T>(next: T | null | undefined, stored: T | null): T | null =>
    next === undefined ? stored : next;
  const optional = (key: string, value: unknown): Record<string, unknown> =>
    value === null || value === undefined ? {} : { [key]: value };
  const endDate =
    patch.endDate === undefined
      ? current.endDate === null
        ? null
        : toIsoDate(current.endDate)
      : patch.endDate;
  return {
    name: patch.name ?? current.name,
    type: current.type,
    amountMinor: patch.amountMinor ?? current.amountMinor.toString(),
    currency: patch.currency ?? current.currency,
    ...optional('accountId', pick(patch.accountId, current.accountId)),
    ...optional('categoryId', pick(patch.categoryId, current.categoryId)),
    ...optional('merchant', pick(patch.merchant, current.merchant)),
    ...optional('paymentMethod', pick(patch.paymentMethod, current.paymentMethod)),
    ...optional('notes', pick(patch.notes, current.notes)),
    frequency: patch.frequency ?? current.frequency,
    interval: patch.interval ?? current.interval,
    startDate: patch.startDate ?? toIsoDate(current.startDate),
    ...optional('endDate', endDate),
    ...optional('reminderDays', pick(patch.reminderDays, current.reminderDays)),
  };
}

function toWrite(input: CreateRecurringScheduleInput, currency: CurrencyCode): ScheduleWrite {
  return {
    name: input.name,
    type: input.type,
    amountMinor: parseMinorUnits(input.amountMinor),
    currency,
    accountId: input.accountId ?? null,
    categoryId: input.categoryId ?? null,
    merchant: input.merchant ?? null,
    paymentMethod: input.paymentMethod ?? null,
    notes: input.notes ?? null,
    frequency: input.frequency,
    interval: input.interval ?? 1,
    startDate: fromIsoDate(input.startDate),
    endDate: input.endDate === undefined ? null : fromIsoDate(input.endDate),
    reminderDays: input.reminderDays ?? null,
  };
}

function compareItems(a: UpcomingOccurrenceDto, b: UpcomingOccurrenceDto): number {
  return (
    a.occurrence.dueDate.localeCompare(b.occurrence.dueDate) ||
    a.schedule.name.localeCompare(b.schedule.name) ||
    a.occurrence.scheduledDate.localeCompare(b.occurrence.scheduledDate)
  );
}

function isPending(occurrence: OccurrenceDto): boolean {
  return (
    occurrence.status === 'upcoming' ||
    occurrence.status === 'due' ||
    occurrence.status === 'overdue'
  );
}

/** Expected amounts of pending occurrences per currency; never added across currencies. */
function pendingTotals(items: readonly UpcomingOccurrenceDto[]): ExpectedTotalsDto[] {
  const totals = new Map<
    CurrencyCode,
    { income: bigint; expense: bigint; ic: number; ec: number }
  >();
  for (const { occurrence, schedule } of items) {
    if (!isPending(occurrence)) continue;
    const entry = totals.get(occurrence.currency) ?? { income: 0n, expense: 0n, ic: 0, ec: 0 };
    if (schedule.type === 'income') {
      entry.income += BigInt(occurrence.amountMinor);
      entry.ic += 1;
    } else {
      entry.expense += BigInt(occurrence.amountMinor);
      entry.ec += 1;
    }
    totals.set(occurrence.currency, entry);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, entry]) => ({
      currency,
      expectedIncomeMinor: serializeMinorUnits(entry.income),
      expectedExpenseMinor: serializeMinorUnits(entry.expense),
      incomeCount: entry.ic,
      expenseCount: entry.ec,
    }));
}

export function createRecurringService({
  repository,
  transactions,
  now,
}: RecurringServiceDependencies): RecurringService {
  const todayFor = (caller: Caller): IsoDateString =>
    calendarDateInTimeZone(now(), caller.timeZone);

  const rowsFor = async (
    caller: Caller,
    schedules: readonly ScheduleWithRefs[],
  ): Promise<Map<string, Map<IsoDateString, OccurrenceRecord>>> => {
    const rows = await repository.occurrencesOf(
      caller.userId,
      schedules.map((schedule) => schedule.id),
    );
    const grouped = new Map<string, OccurrenceRecord[]>();
    for (const row of rows) {
      grouped.set(row.scheduleId, [...(grouped.get(row.scheduleId) ?? []), row]);
    }
    return new Map(
      schedules.map((schedule) => [schedule.id, rowsByDate(grouped.get(schedule.id) ?? [])]),
    );
  };

  const loadItem = async (
    caller: Caller,
    scheduleId: string,
  ): Promise<RecurringScheduleItemDto> => {
    const schedule = await repository.find(caller.userId, scheduleId);
    if (schedule === null) {
      throw notFound();
    }
    const rows = (await rowsFor(caller, [schedule])).get(schedule.id) ?? NO_ROWS;
    return toScheduleItemDto(schedule, rows, todayFor(caller));
  };

  const loadOccurrence = async (
    caller: Caller,
    { scheduleId, date }: OccurrenceAddress,
  ): Promise<OccurrenceActionResultDto> => {
    const schedule = await repository.find(caller.userId, scheduleId);
    if (schedule === null) {
      throw notFound();
    }
    const rows = (await rowsFor(caller, [schedule])).get(schedule.id) ?? NO_ROWS;
    const today = todayFor(caller);
    const row = rows.get(date);
    return {
      occurrence: toOccurrenceDto(
        schedule,
        { scheduledDate: date, dueDate: row === undefined ? date : toIsoDate(row.dueDate), row },
        today,
      ),
      schedule: toScheduleItemDto(schedule, rows, today),
    };
  };

  /** Locks the schedule inside `store`'s transaction; 404 when it is not the caller's. */
  const lockOne = async (
    store: ScheduleStore,
    caller: Caller,
    scheduleId: string,
  ): Promise<ScheduleRecord> => {
    const schedule = await store.lock(caller.userId, scheduleId);
    if (schedule === null) {
      throw notFound();
    }
    return schedule;
  };

  /** Recomputes and stores the cursor from the schedule's rule and rows. */
  const advance = async (
    store: ScheduleStore,
    schedule: Pick<ScheduleRecord, 'id' | 'frequency' | 'interval' | 'startDate' | 'endDate'>,
  ): Promise<void> => {
    const rows = rowsByDate(await store.occurrences(schedule.id));
    const cursor = nextCursor(schedule, rows);
    await store.update(schedule.id, {
      nextOccurrenceDate: cursor === undefined ? null : fromIsoDate(cursor),
    });
  };

  /** Checks that `date` is an occurrence of the schedule people may act on now. */
  const assertActionable = (
    caller: Caller,
    schedule: ScheduleRecord,
    date: IsoDateString,
  ): void => {
    const status = scheduleStatus(schedule);
    if (status === 'archived') {
      throw conflict('Restore this recurring payment before changing its payments.');
    }
    if (status === 'paused') {
      throw conflict('This recurring payment is paused. Resume it first.');
    }
    if (!isOccurrenceDate(ruleOf(schedule), date)) {
      throw occurrenceNotFound();
    }
    if (daysBetween(todayFor(caller), date) > OCCURRENCE_ACTION_HORIZON_DAYS) {
      throw conflict('That payment is more than a year away. Change it closer to the date.');
    }
  };

  /** An account of the caller's in the schedule's currency, or a field problem. */
  const checkAccount = async (
    caller: Caller,
    accountId: string | null,
    currency: CurrencyCode,
    path: string,
    keepId: string | null = null,
  ): Promise<ApiErrorDetail | undefined> => {
    if (accountId === null) return undefined;
    const account = await repository.findAccount(caller.userId, accountId);
    if (account === null) {
      return { path, message: 'Choose one of your accounts.' };
    }
    // An account archived after it was chosen may stay on the plan; recording still needs an
    // active one (the transaction module refuses archived accounts).
    if (account.archivedAt !== null && account.id !== keepId) {
      return { path, message: `“${account.name}” is archived. Choose an active account.` };
    }
    if (account.currency !== currency) {
      return {
        path,
        message: `“${account.name}” is in ${account.currency}, but this is in ${currency}.`,
      };
    }
    return undefined;
  };

  const checkCategory = async (
    caller: Caller,
    categoryId: string | null,
    type: CreateRecurringScheduleInput['type'],
    keepId: string | null,
  ): Promise<ApiErrorDetail | undefined> => {
    if (categoryId === null) return undefined;
    const category = await repository.findCategory(caller.userId, categoryId);
    if (category === null) {
      return { path: 'body.categoryId', message: 'Choose one of your categories.' };
    }
    if (category.kind !== type) {
      return {
        path: 'body.categoryId',
        message: `Choose ${type === 'income' ? 'an income' : 'a spending'} category.`,
      };
    }
    if (category.archivedAt !== null && category.id !== keepId) {
      return { path: 'body.categoryId', message: `“${category.name}” is archived.` };
    }
    return undefined;
  };

  const resolveCurrency = async (
    caller: Caller,
    input: Pick<CreateRecurringScheduleInput, 'accountId' | 'currency'>,
  ): Promise<CurrencyCode> => {
    if (input.currency !== undefined) return input.currency;
    if (input.accountId !== undefined) {
      const account = await repository.findAccount(caller.userId, input.accountId);
      if (account !== null) {
        const currency = currencyOf(account.currency);
        if (currency !== undefined) return currency;
      }
    }
    throw invalid([
      {
        path: 'body.currency',
        message: 'Choose a currency, or the account the money moves through.',
      },
    ]);
  };

  const collect = async (
    caller: Caller,
    { from, to, type, subscription, limit }: CollectOptions,
  ): Promise<UpcomingOccurrencesDto> => {
    const today = todayFor(caller);
    const schedules = await repository.list(caller.userId, {
      status: 'current',
      type,
      subscription,
    });
    const rowsById = await rowsFor(caller, schedules);
    const items: UpcomingOccurrenceDto[] = [];
    let truncated = false;

    for (const schedule of schedules) {
      const rows = rowsById.get(schedule.id) ?? NO_ROWS;
      const refs = {
        schedule: toScheduleDto(schedule),
        ...(schedule.account === null ? {} : { account: toAccountRef(schedule.account) }),
        ...(schedule.category === null
          ? {}
          : { category: toPlanningCategoryRef(schedule.category) }),
      };
      // Still expected: overdue whatever the range, otherwise due within it.
      const pending = pendingOccurrences(schedule, rows, to, limit + 1);
      if (pending.length > limit) truncated = true;
      for (const entry of pending.slice(0, limit)) {
        if (entry.dueDate < today || (entry.dueDate >= from && entry.dueDate <= to)) {
          items.push({ occurrence: toOccurrenceDto(schedule, entry, today), ...refs });
        }
      }
      // Already settled and due within the range: recorded, skipped, or passed over.
      for (const [scheduledDate, row] of rows) {
        const dueDate = toIsoDate(row.dueDate);
        if (isResolved(row) && dueDate >= from && dueDate <= to) {
          items.push({
            occurrence: toOccurrenceDto(schedule, { scheduledDate, dueDate, row }, today),
            ...refs,
          });
        }
      }
    }

    items.sort(compareItems);
    if (items.length > limit) truncated = true;
    const returned = items.slice(0, limit);
    return {
      today,
      from,
      to,
      items: returned,
      pendingTotals: pendingTotals(returned),
      overdueCount: returned.filter((item) => item.occurrence.status === 'overdue').length,
      truncated,
    };
  };

  /** Runs an occurrence change under the schedule lock and returns the occurrence afterwards. */
  const changeOccurrence = async (
    caller: Caller,
    address: OccurrenceAddress,
    change: (
      store: ScheduleStore,
      schedule: ScheduleRecord,
      row: OccurrenceRecord | undefined,
    ) => Promise<void>,
  ): Promise<OccurrenceActionResultDto> => {
    await repository.inScheduleWrite(async (store) => {
      const schedule = await lockOne(store, caller, address.scheduleId);
      assertActionable(caller, schedule, address.date);
      const row = rowsByDate(await store.occurrences(schedule.id)).get(address.date);
      await change(store, schedule, row);
    });
    return loadOccurrence(caller, address);
  };

  return {
    today: todayFor,

    list: async (caller, { status, type, subscription }) => {
      const schedules = await repository.list(caller.userId, { status, type, subscription });
      const rowsById = await rowsFor(caller, schedules);
      const today = todayFor(caller);
      return {
        today,
        schedules: schedules.map((schedule) =>
          toScheduleItemDto(schedule, rowsById.get(schedule.id) ?? NO_ROWS, today),
        ),
      };
    },

    get: async (caller, scheduleId) => {
      const schedule = await repository.find(caller.userId, scheduleId);
      if (schedule === null) {
        throw notFound();
      }
      const rows = (await rowsFor(caller, [schedule])).get(schedule.id) ?? NO_ROWS;
      const today = todayFor(caller);
      const lastUpcoming = addDaysToIsoDate(today, MAX_UPCOMING_RANGE_DAYS * 10);
      return {
        ...toScheduleItemDto(schedule, rows, today),
        today,
        upcoming: pendingOccurrences(schedule, rows, lastUpcoming, UPCOMING_IN_DETAIL).map(
          (entry) => toOccurrenceDto(schedule, entry, today),
        ),
        history: [...rows.entries()]
          .filter(([, row]) => isResolved(row))
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, HISTORY_IN_DETAIL)
          .map(([scheduledDate, row]) =>
            toOccurrenceDto(
              schedule,
              { scheduledDate, dueDate: toIsoDate(row.dueDate), row },
              today,
            ),
          ),
      };
    },

    create: async (caller, input, options = { isSubscription: false }) => {
      if (options.isSubscription && input.type !== 'expense') {
        throw invalid([{ path: 'body.type', message: 'Subscriptions are always expenses.' }]);
      }
      const currency = await resolveCurrency(caller, input);
      const write = toWrite(input, currency);
      const problems = [
        await checkAccount(caller, write.accountId, currency, 'body.accountId'),
        await checkCategory(caller, write.categoryId, input.type, null),
      ].filter((problem) => problem !== undefined);
      if (problems.length > 0) {
        throw invalid(problems);
      }
      const created = await repository.inScheduleWrite((store) =>
        store.create(caller.userId, write, {
          isSubscription: options.isSubscription,
          // A new schedule expects its first date first.
          nextOccurrenceDate: write.startDate,
          createdAt: now(),
        }),
      );
      return loadItem(caller, created.id);
    },

    update: async (caller, scheduleId, patch) => {
      await repository.inScheduleWrite(async (store) => {
        const current = await lockOne(store, caller, scheduleId);
        if (current.archivedAt !== null) {
          throw conflict('Restore this recurring payment before editing it.');
        }
        if (
          current.cancelledAt !== null &&
          (patch.frequency !== undefined ||
            patch.interval !== undefined ||
            patch.startDate !== undefined ||
            patch.endDate !== undefined ||
            patch.amountMinor !== undefined ||
            patch.currency !== undefined)
        ) {
          throw conflict(
            'This subscription is cancelled, so its amount and dates stay as they were. Add a new one to start again.',
          );
        }
        const parsed = createRecurringScheduleInputSchema.safeParse(mergeUpdate(current, patch));
        if (!parsed.success) {
          throw invalid(
            parsed.error.issues.map((issue) => ({
              path: ['body', ...issue.path.map(String)].join('.'),
              message: issue.message,
            })),
          );
        }
        const merged = parsed.data;
        const currency = merged.currency ?? currencyOf(current.currency);
        if (currency === undefined) {
          throw new Error('Stored schedule has an unsupported currency.');
        }
        const write = toWrite(merged, currency);
        const problems = [
          await checkAccount(
            caller,
            write.accountId,
            currency,
            'body.accountId',
            current.accountId,
          ),
          await checkCategory(caller, write.categoryId, merged.type, current.categoryId),
        ].filter((problem) => problem !== undefined);
        if (problems.length > 0) {
          throw invalid(problems);
        }

        const rows = await store.occurrences(current.id);
        const lastResolved = lastResolvedDate(rows);
        const timingChanged = timingOf(write) !== timingOf(current);
        if (timingChanged) {
          // Recorded history keeps its dates; the new timing starts after all of it.
          if (lastResolved !== undefined && toIsoDate(write.startDate) <= lastResolved) {
            throw invalid([
              {
                path: 'body.startDate',
                message: `A payment on ${lastResolved} is already recorded or skipped. Start the new timing after it.`,
              },
            ]);
          }
          await store.deletePostponed(current.id);
        }
        if (
          write.endDate !== null &&
          lastResolved !== undefined &&
          toIsoDate(write.endDate) < lastResolved
        ) {
          throw invalid([
            {
              path: 'body.endDate',
              message: `A payment on ${lastResolved} is already recorded or skipped. End on or after it.`,
            },
          ]);
        }
        if (write.endDate !== null) {
          await store.deletePostponed(current.id, write.endDate);
        }
        await store.update(current.id, write);
        await advance(store, { ...current, ...write });
      });
      return loadItem(caller, scheduleId);
    },

    pause: async (caller, scheduleId) => {
      await repository.inScheduleWrite(async (store) => {
        const current = await lockOne(store, caller, scheduleId);
        if (current.archivedAt !== null) {
          throw conflict('Restore this recurring payment before pausing it.');
        }
        if (current.pausedAt === null) {
          await store.update(current.id, { pausedAt: now() });
        }
      });
      return loadItem(caller, scheduleId);
    },

    resume: async (caller, scheduleId) => {
      await repository.inScheduleWrite(async (store) => {
        const current = await lockOne(store, caller, scheduleId);
        if (current.archivedAt !== null) {
          throw conflict('Restore this recurring payment before resuming it.');
        }
        if (current.pausedAt === null) {
          return;
        }
        // Payments that fell while it was paused are not owed: mark them as passed over, so they
        // never appear as overdue. Ones that were already overdue before the pause stay expected.
        const pausedOn = calendarDateInTimeZone(current.pausedAt, caller.timeZone);
        const today = todayFor(caller);
        const rows = rowsByDate(await store.occurrences(current.id));
        if (pausedOn < today) {
          const missed = occurrencesBetween(
            ruleOf(current),
            pausedOn,
            addDaysToIsoDate(today, -1),
            MAX_PAUSED_OCCURRENCES,
          ).filter((date) => !isResolved(rows.get(date)));
          for (const date of missed.filter((entry) => rows.has(entry))) {
            await store.deleteOccurrence(current.id, fromIsoDate(date));
          }
          await store.addPausedOccurrences(
            caller.userId,
            current.id,
            missed.map(fromIsoDate),
            now(),
          );
        }
        await store.update(current.id, { pausedAt: null });
        await advance(store, current);
      });
      return loadItem(caller, scheduleId);
    },

    end: async (caller, scheduleId, input, options = { cancel: false }) => {
      await repository.inScheduleWrite(async (store) => {
        const current = await lockOne(store, caller, scheduleId);
        if (current.archivedAt !== null) {
          throw conflict('Restore this recurring payment before ending it.');
        }
        if (options.cancel && !current.isSubscription) {
          throw notFound();
        }
        if (options.cancel && current.cancelledAt !== null) {
          return; // Already cancelled: repeating the request changes nothing.
        }
        const endDate = input.endDate ?? todayFor(caller);
        const rows = await store.occurrences(current.id);
        const lastResolved = lastResolvedDate(rows);
        if (endDate < toIsoDate(current.startDate)) {
          throw invalid([
            { path: 'body.endDate', message: 'End on or after the first payment date.' },
          ]);
        }
        if (lastResolved !== undefined && endDate < lastResolved) {
          throw invalid([
            {
              path: 'body.endDate',
              message: `A payment on ${lastResolved} is already recorded or skipped. End on or after it.`,
            },
          ]);
        }
        const end = fromIsoDate(endDate);
        await store.deletePostponed(current.id, end);
        await store.update(current.id, {
          endDate: end,
          ...(options.cancel ? { cancelledAt: now() } : {}),
        });
        await advance(store, { ...current, endDate: end });
      });
      return loadItem(caller, scheduleId);
    },

    archive: async (caller, scheduleId) => {
      await repository.inScheduleWrite(async (store) => {
        const current = await lockOne(store, caller, scheduleId);
        if (current.archivedAt === null) {
          await store.update(current.id, { archivedAt: now() });
        }
      });
      return loadItem(caller, scheduleId);
    },

    restore: async (caller, scheduleId) => {
      await repository.inScheduleWrite(async (store) => {
        const current = await lockOne(store, caller, scheduleId);
        if (current.archivedAt !== null) {
          await store.update(current.id, { archivedAt: null });
        }
      });
      return loadItem(caller, scheduleId);
    },

    upcoming: (caller, { from, to, type, subscription }) => {
      const start = from ?? todayFor(caller);
      const end = to ?? addDaysToIsoDate(start, DEFAULT_UPCOMING_DAYS);
      if (daysBetween(start, end) > MAX_UPCOMING_RANGE_DAYS) {
        throw invalid([
          {
            path: 'query.to',
            message: `Choose a range of at most ${String(MAX_UPCOMING_RANGE_DAYS)} days.`,
          },
        ]);
      }
      return collect(caller, {
        from: start,
        to: end,
        type,
        subscription,
        limit: MAX_UPCOMING_OCCURRENCES,
      });
    },

    collect,

    occurrence: async (caller, address) => {
      const schedule = await repository.find(caller.userId, address.scheduleId);
      if (schedule === null || !isOccurrenceDate(ruleOf(schedule), address.date)) {
        return undefined;
      }
      return loadOccurrence(caller, address);
    },

    record: async (caller, address, input) => {
      // Read first to build the transaction; the claim below re-checks everything under the lock
      // and refuses the write if the schedule changed in between.
      const seen = await repository.find(caller.userId, address.scheduleId);
      if (seen === null) {
        throw notFound();
      }
      assertActionable(caller, seen, address.date);
      const type = seen.type === 'income' ? 'income' : 'expense';
      const accountId = input.accountId ?? seen.accountId;
      const categoryId = input.categoryId ?? seen.categoryId;
      const problems: ApiErrorDetail[] = [];
      if (accountId === null) {
        problems.push({
          path: 'body.accountId',
          message: 'Choose the account the money moved through.',
        });
      }
      if (categoryId === null) {
        problems.push({ path: 'body.categoryId', message: 'Choose a category.' });
      }
      const currency = currencyOf(seen.currency);
      if (accountId !== null && currency !== undefined) {
        const accountProblem = await checkAccount(caller, accountId, currency, 'body.accountId');
        if (accountProblem !== undefined) problems.push(accountProblem);
      }
      if (problems.length > 0 || accountId === null || categoryId === null) {
        throw invalid(problems);
      }
      const merchant = input.merchant ?? seen.merchant;
      const paymentMethod = input.paymentMethod ?? seen.paymentMethod;
      const transaction: CreateTransactionInput = {
        type,
        accountId,
        categoryId,
        amountMinor: input.amountMinor ?? seen.amountMinor.toString(),
        occurredAt: input.occurredAt ?? now().toISOString(),
        description: input.description ?? seen.name,
        ...(merchant === null ? {} : { merchant }),
        ...(paymentMethod === null ? {} : { paymentMethod }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      };

      const scheduledDate = fromIsoDate(address.date);
      const outcome = await transactions.recordLinked(caller, transaction, {
        claim: async (db) => {
          const store = repository.storeFor(db);
          const locked = await lockOne(store, caller, address.scheduleId);
          const row = rowsByDate(await store.occurrences(locked.id)).get(address.date);
          if (row?.state === 'recorded' && row.transactionId !== null) {
            return row.transactionId; // Recorded by an earlier request: never record it twice.
          }
          if (row?.state === 'skipped' || row?.state === 'paused') {
            throw conflict(
              'This payment was skipped. Choose “Expect it after all” before recording it.',
            );
          }
          if (locked.updatedAt.getTime() !== seen.updatedAt.getTime()) {
            throw conflict('This recurring payment changed meanwhile. Review it and try again.');
          }
          assertActionable(caller, locked, address.date);
          return undefined;
        },
        commit: async (db, transactionId) => {
          const store = repository.storeFor(db);
          const row = rowsByDate(await store.occurrences(seen.id)).get(address.date);
          await store.putOccurrence(caller.userId, seen.id, scheduledDate, {
            dueDate: row === undefined ? scheduledDate : row.dueDate,
            state: 'recorded',
            transactionId,
            resolvedAt: now(),
          });
          await advance(store, seen);
        },
      });

      const loaded = await loadOccurrence(caller, address);
      return {
        result: { ...loaded, transaction: outcome.item },
        replayed: outcome.replayed,
      };
    },

    skip: (caller, address) =>
      changeOccurrence(caller, address, async (store, schedule, row) => {
        if (row?.state === 'recorded') {
          throw conflict('This payment is already recorded. Void its transaction instead.');
        }
        if (isResolved(row)) {
          return; // Already skipped or passed over: nothing changes.
        }
        const scheduledDate = fromIsoDate(address.date);
        await store.putOccurrence(caller.userId, schedule.id, scheduledDate, {
          dueDate: row === undefined ? scheduledDate : row.dueDate,
          state: 'skipped',
          transactionId: null,
          resolvedAt: now(),
        });
        await advance(store, schedule);
      }),

    unskip: (caller, address) =>
      changeOccurrence(caller, address, async (store, schedule, row) => {
        if (row?.state === 'recorded') {
          throw conflict('This payment is already recorded.');
        }
        if (row?.state !== 'skipped' && row?.state !== 'paused') {
          return; // Already expected.
        }
        await store.deleteOccurrence(schedule.id, fromIsoDate(address.date));
        await advance(store, schedule);
      }),

    link: async (caller, address, { transactionId }) => {
      const scheduledDate = fromIsoDate(address.date);
      const replayed = await repository.inScheduleWrite(async (store) => {
        const schedule = await lockOne(store, caller, address.scheduleId);
        const row = rowsByDate(await store.occurrences(schedule.id)).get(address.date);
        if (row?.state === 'recorded' && row.transactionId !== null) {
          if (row.transactionId === transactionId) {
            return true; // Linked by an earlier request: nothing changes.
          }
          throw conflict('This payment is already recorded with another transaction.');
        }
        if (row?.state === 'skipped' || row?.state === 'paused') {
          throw conflict(
            'This payment was skipped. Choose “Expect it after all” before recording it.',
          );
        }
        assertActionable(caller, schedule, address.date);
        // Locked until commit: it cannot be voided, edited, or linked elsewhere meanwhile.
        const transaction = await store.lockTransaction(caller.userId, transactionId);
        if (transaction === null) {
          throw invalid([
            { path: 'body.transactionId', message: 'Choose one of your transactions.' },
          ]);
        }
        const dueDate = row === undefined ? address.date : toIsoDate(row.dueDate);
        const problems = linkProblems(
          schedule,
          transaction,
          calendarDateInTimeZone(transaction.occurredAt, caller.timeZone),
          linkWindow(address.date, dueDate),
        );
        if (problems.length > 0) {
          throw invalid(problems.map((message) => ({ path: 'body.transactionId', message })));
        }
        if ((await store.occurrenceOfTransaction(transaction.id)) !== null) {
          throw conflict('That transaction already settles another scheduled payment.');
        }
        await store.putOccurrence(caller.userId, schedule.id, scheduledDate, {
          dueDate: row === undefined ? scheduledDate : row.dueDate,
          state: 'recorded',
          transactionId: transaction.id,
          resolvedAt: now(),
        });
        await advance(store, schedule);
        return false;
      });

      const loaded = await loadOccurrence(caller, address);
      return {
        result: { ...loaded, transaction: await transactions.get(caller, transactionId) },
        replayed,
      };
    },

    linkCandidates: async (caller, address) => {
      const schedule = await repository.find(caller.userId, address.scheduleId);
      if (schedule === null) {
        throw notFound();
      }
      if (!isOccurrenceDate(ruleOf(schedule), address.date)) {
        throw occurrenceNotFound();
      }
      const row = (await repository.occurrencesOf(caller.userId, [schedule.id])).find(
        (occurrence) => toIsoDate(occurrence.scheduledDate) === address.date,
      );
      if (isResolved(row)) {
        return { candidates: [] };
      }
      const due = row === undefined ? address.date : toIsoDate(row.dueDate);
      const window = linkWindow(address.date, due);
      // A day of slack on each side covers every time zone; exact local dates are checked below.
      const rows = await repository.linkCandidates(caller.userId, {
        type: schedule.type === 'income' ? 'income' : 'expense',
        currency: schedule.currency,
        from: fromIsoDate(addDaysToIsoDate(window.from, -1)),
        to: fromIsoDate(addDaysToIsoDate(window.to, 2)),
        expectedMinor: schedule.amountMinor,
        dueAt: fromIsoDate(due),
        limit: MAX_OCCURRENCE_LINK_CANDIDATES + 4,
      });
      const ranked = rows
        .filter((transaction) => {
          const on = calendarDateInTimeZone(transaction.occurredAt, caller.timeZone);
          return on >= window.from && on <= window.to;
        })
        .slice(0, MAX_OCCURRENCE_LINK_CANDIDATES);
      const candidates = [];
      for (const candidate of ranked) {
        candidates.push(await transactions.get(caller, candidate.id));
      }
      return { candidates };
    },

    postpone: (caller, address, input) =>
      changeOccurrence(caller, address, async (store, schedule, row) => {
        if (isResolved(row)) {
          throw conflict(
            row?.state === 'recorded'
              ? 'This payment is already recorded.'
              : 'This payment was skipped. Choose “Expect it after all” first.',
          );
        }
        const currentDue = row === undefined ? address.date : toIsoDate(row.dueDate);
        if (input.dueDate <= currentDue) {
          throw invalid([
            { path: 'body.dueDate', message: 'Choose a date after the current due date.' },
          ]);
        }
        if (daysBetween(address.date, input.dueDate) > MAX_POSTPONE_DAYS) {
          throw invalid([{ path: 'body.dueDate', message: 'Postpone by at most a year.' }]);
        }
        await store.putOccurrence(caller.userId, schedule.id, fromIsoDate(address.date), {
          dueDate: fromIsoDate(input.dueDate),
          state: 'postponed',
          transactionId: null,
          resolvedAt: null,
        });
      }),
  };
}
