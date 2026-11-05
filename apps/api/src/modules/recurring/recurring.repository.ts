import {
  MAX_RECURRING_SCHEDULES,
  type OccurrenceState,
  type PaymentMethod,
  type RecurringFrequency,
  type RecurringStatusFilter,
  type RecurringType,
} from '@calmcash/shared';
import { z } from 'zod';

import type { Prisma } from '../../generated/prisma/client';
import type {
  Account,
  Category,
  PrismaClient,
  RecurringSchedule,
  Transaction,
} from '../../generated/prisma/client';
import type { LinkedWriteClient } from '../transactions';

// Database access for recurring schedules and the occurrences people acted on. Every query is
// scoped by the owner's user ID. Writes run in one database transaction that first locks the
// schedule row (`SELECT … FOR UPDATE`); confirming a payment takes that lock inside the
// transaction module's ledger, before any account lock, so lock order stays global. Linking an
// existing transaction locks the schedule, then that transaction row (never the reverse).

export type ScheduleRecord = RecurringSchedule;

const occurrenceInclude = {
  transaction: { select: { amountMinor: true, currency: true, voidedAt: true } },
} satisfies Prisma.ScheduledOccurrenceInclude;

/** A stored occurrence with the amount and state of its transaction (recorded ones only). */
export type OccurrenceRecord = Prisma.ScheduledOccurrenceGetPayload<{
  include: typeof occurrenceInclude;
}>;

const refsInclude = {
  account: true,
  category: { include: { parent: { select: { name: true } } } },
} satisfies Prisma.RecurringScheduleInclude;

/** A schedule with its account and category, as views show it. */
export type ScheduleWithRefs = Prisma.RecurringScheduleGetPayload<{ include: typeof refsInclude }>;

export interface ScheduleListFilter {
  status: RecurringStatusFilter;
  type?: RecurringType | undefined;
  subscription?: boolean | undefined;
  /** Only these schedules. */
  ids?: readonly string[] | undefined;
}

/** Columns a create or an edit sets. */
export interface ScheduleWrite {
  name: string;
  type: RecurringType;
  amountMinor: bigint;
  currency: string;
  accountId: string | null;
  categoryId: string | null;
  merchant: string | null;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  frequency: RecurringFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  reminderDays: number | null;
}

export interface ScheduleStateChange {
  nextOccurrenceDate?: Date | null;
  pausedAt?: Date | null;
  archivedAt?: Date | null;
  cancelledAt?: Date | null;
  endDate?: Date | null;
}

export interface OccurrenceWrite {
  dueDate: Date;
  state: OccurrenceState;
  transactionId: string | null;
  resolvedAt: Date | null;
}

/** Operations on one locked schedule, inside a database transaction. */
export interface ScheduleStore {
  /** Locks the user's schedule (`SELECT … FOR UPDATE`); null when it is not theirs. */
  lock: (userId: string, scheduleId: string) => Promise<ScheduleRecord | null>;
  occurrences: (scheduleId: string) => Promise<OccurrenceRecord[]>;
  findAccount: (userId: string, accountId: string) => Promise<Account | null>;
  findCategory: (userId: string, categoryId: string) => Promise<Category | null>;
  create: (
    userId: string,
    write: ScheduleWrite,
    options: { isSubscription: boolean; nextOccurrenceDate: Date | null; createdAt: Date },
  ) => Promise<ScheduleRecord>;
  update: (
    scheduleId: string,
    change: Partial<ScheduleWrite> & ScheduleStateChange,
  ) => Promise<void>;
  /** Creates or replaces the row for `(scheduleId, scheduledDate)`. */
  putOccurrence: (
    userId: string,
    scheduleId: string,
    scheduledDate: Date,
    write: OccurrenceWrite,
  ) => Promise<void>;
  /** Several `paused` rows at once (dates already free). */
  addPausedOccurrences: (
    userId: string,
    scheduleId: string,
    scheduledDates: readonly Date[],
    resolvedAt: Date,
  ) => Promise<void>;
  deleteOccurrence: (scheduleId: string, scheduledDate: Date) => Promise<void>;
  /** Removes postponed (still expected) rows, optionally only those scheduled after a date. */
  deletePostponed: (scheduleId: string, after?: Date) => Promise<void>;
  /**
   * Locks the user's transaction (`SELECT … FOR UPDATE`) so it cannot be voided, edited, or linked
   * elsewhere until this write commits; null when it is not theirs.
   */
  lockTransaction: (userId: string, transactionId: string) => Promise<Transaction | null>;
  /** The occurrence a transaction already settles, if any. */
  occurrenceOfTransaction: (
    transactionId: string,
  ) => Promise<Pick<OccurrenceRecord, 'scheduleId' | 'scheduledDate'> | null>;
}

/** Filter of transactions that could settle one occurrence (see `linkCandidates`). */
export interface LinkCandidateFilter {
  type: 'income' | 'expense';
  currency: string;
  from: Date;
  to: Date;
  /** The schedule's expected amount and due instant: closest amount first, then closest date. */
  expectedMinor: bigint;
  dueAt: Date;
  limit: number;
}

export interface RecurringRepository {
  list: (userId: string, filter: ScheduleListFilter) => Promise<ScheduleWithRefs[]>;
  find: (userId: string, scheduleId: string) => Promise<ScheduleWithRefs | null>;
  /** Stored occurrences of these schedules, optionally only resolved ones newest first. */
  occurrencesOf: (userId: string, scheduleIds: readonly string[]) => Promise<OccurrenceRecord[]>;
  findAccount: (userId: string, accountId: string) => Promise<Account | null>;
  findCategory: (userId: string, categoryId: string) => Promise<Category | null>;
  /** Runs `work` in one database transaction; anything it throws rolls everything back. */
  inScheduleWrite: <T>(work: (store: ScheduleStore) => Promise<T>) => Promise<T>;
  /** The same operations on a transaction another module opened (a linked ledger write). */
  storeFor: (db: LinkedWriteClient) => ScheduleStore;
  /** Active transactions of the user that settle no occurrence yet, best match first. */
  linkCandidates: (userId: string, filter: LinkCandidateFilter) => Promise<Transaction[]>;
}

const idRowSchema = z.object({ id: z.string() });

function statusWhere(status: RecurringStatusFilter): Prisma.RecurringScheduleWhereInput {
  switch (status) {
    case 'current':
      return { archivedAt: null };
    case 'archived':
      return { archivedAt: { not: null } };
    case 'all':
      return {};
  }
}

function createStore(tx: Prisma.TransactionClient): ScheduleStore {
  return {
    lock: async (userId, scheduleId) => {
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM recurring_schedules
        WHERE user_id = ${userId}::uuid AND id = ${scheduleId}::uuid
        FOR UPDATE`;
      const [row] = z.array(idRowSchema).parse(rows);
      return row === undefined ? null : tx.recurringSchedule.findUnique({ where: { id: row.id } });
    },

    occurrences: (scheduleId) =>
      tx.scheduledOccurrence.findMany({
        where: { scheduleId },
        include: occurrenceInclude,
        orderBy: { scheduledDate: 'asc' },
      }),

    findAccount: (userId, accountId) => tx.account.findFirst({ where: { id: accountId, userId } }),

    findCategory: (userId, categoryId) =>
      tx.category.findFirst({ where: { id: categoryId, userId } }),

    create: (userId, write, { isSubscription, nextOccurrenceDate, createdAt }) =>
      tx.recurringSchedule.create({
        data: { ...write, userId, isSubscription, nextOccurrenceDate, createdAt },
      }),

    update: async (scheduleId, change) => {
      await tx.recurringSchedule.update({ where: { id: scheduleId }, data: change });
    },

    putOccurrence: async (userId, scheduleId, scheduledDate, write) => {
      await tx.scheduledOccurrence.upsert({
        where: { scheduleId_scheduledDate: { scheduleId, scheduledDate } },
        create: { ...write, userId, scheduleId, scheduledDate },
        update: write,
      });
    },

    addPausedOccurrences: async (userId, scheduleId, scheduledDates, resolvedAt) => {
      if (scheduledDates.length === 0) return;
      await tx.scheduledOccurrence.createMany({
        data: scheduledDates.map((scheduledDate) => ({
          userId,
          scheduleId,
          scheduledDate,
          dueDate: scheduledDate,
          state: 'paused' as const,
          resolvedAt,
        })),
      });
    },

    lockTransaction: async (userId, transactionId) => {
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM transactions
        WHERE user_id = ${userId}::uuid AND id = ${transactionId}::uuid
        FOR UPDATE`;
      const [row] = z.array(idRowSchema).parse(rows);
      return row === undefined ? null : tx.transaction.findUnique({ where: { id: row.id } });
    },

    occurrenceOfTransaction: (transactionId) =>
      tx.scheduledOccurrence.findUnique({
        where: { transactionId },
        select: { scheduleId: true, scheduledDate: true },
      }),

    deleteOccurrence: async (scheduleId, scheduledDate) => {
      await tx.scheduledOccurrence.deleteMany({ where: { scheduleId, scheduledDate } });
    },

    deletePostponed: async (scheduleId, after) => {
      await tx.scheduledOccurrence.deleteMany({
        where: {
          scheduleId,
          state: 'postponed',
          ...(after === undefined ? {} : { scheduledDate: { gt: after } }),
        },
      });
    },
  };
}

export function createPrismaRecurringRepository(prisma: PrismaClient): RecurringRepository {
  return {
    list: (userId, { status, type, subscription, ids }) =>
      prisma.recurringSchedule.findMany({
        where: {
          userId,
          ...statusWhere(status),
          ...(type === undefined ? {} : { type }),
          ...(subscription === undefined ? {} : { isSubscription: subscription }),
          ...(ids === undefined ? {} : { id: { in: [...ids] } }),
        },
        include: refsInclude,
        orderBy: [
          { nextOccurrenceDate: { sort: 'asc', nulls: 'last' } },
          { name: 'asc' },
          { id: 'asc' },
        ],
        take: MAX_RECURRING_SCHEDULES,
      }),

    find: (userId, scheduleId) =>
      prisma.recurringSchedule.findFirst({
        where: { id: scheduleId, userId },
        include: refsInclude,
      }),

    occurrencesOf: (userId, scheduleIds) =>
      scheduleIds.length === 0
        ? Promise.resolve([])
        : prisma.scheduledOccurrence.findMany({
            where: { userId, scheduleId: { in: [...scheduleIds] } },
            include: occurrenceInclude,
            orderBy: [{ scheduleId: 'asc' }, { scheduledDate: 'asc' }],
          }),

    findAccount: (userId, accountId) =>
      prisma.account.findFirst({ where: { id: accountId, userId } }),

    findCategory: (userId, categoryId) =>
      prisma.category.findFirst({ where: { id: categoryId, userId } }),

    inScheduleWrite: (work) =>
      prisma.$transaction((tx) => work(createStore(tx)), { maxWait: 10_000, timeout: 20_000 }),

    storeFor: (db) => createStore(db),

    linkCandidates: async (userId, { type, currency, from, to, expectedMinor, dueAt, limit }) => {
      // Ranked in the database, so many small recent entries cannot crowd out the real payment.
      const rows: unknown = await prisma.$queryRaw`
        SELECT t.id::text AS "id"
        FROM transactions t
        WHERE t.user_id = ${userId}::uuid
          AND t.type = ${type}::transaction_type
          AND t.currency = ${currency}
          AND t.voided_at IS NULL
          AND t.occurred_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM scheduled_occurrences o WHERE o.transaction_id = t.id)
        ORDER BY abs(t.amount_minor - ${expectedMinor}),
                 abs(extract(epoch FROM t.occurred_at - ${dueAt}::timestamptz)),
                 t.id
        LIMIT ${limit}`;
      const ids = z
        .array(idRowSchema)
        .parse(rows)
        .map((row) => row.id);
      if (ids.length === 0) return [];
      const found = await prisma.transaction.findMany({ where: { userId, id: { in: ids } } });
      const byId = new Map(found.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [row];
      });
    },
  };
}
