import {
  IMPORT_ROWS_PAGE_SIZE,
  MAX_IMPORT_BATCHES_LISTED,
  type ImportRowStatus,
  type StatementDirection,
} from '@calmcash/shared';
import { z } from 'zod';

import type { Prisma } from '../../generated/prisma/client';
import type {
  Account,
  Category,
  PrismaClient,
  StatementImport,
  StatementImportRow,
  Transaction,
} from '../../generated/prisma/client';
import {
  calculateCurrentBalance,
  NO_MOVEMENTS,
  queryMovementTotals,
  readCountsFrom,
} from '../accounts';
import type { LinkedWriteClient } from '../transactions';

// Database access for statement imports. Every query is scoped by the owner's user ID. Writes run
// in a database transaction that locks the batch row (`SELECT … FOR UPDATE`), so settings changes,
// decisions, and completion of one statement queue instead of interleaving; importing a row locks
// that row inside the transaction module's ledger write instead.

export type BatchRecord = StatementImport;
export type RowRecord = StatementImportRow;
export type BatchWithAccount = Prisma.StatementImportGetPayload<{ include: { account: true } }>;

export interface NewBatch {
  accountId: string;
  fileName: string;
  delimiter: string;
  hasHeaderRow: boolean;
  currency: string;
  columns: string[];
  createdAt: Date;
}

/** The evaluated state of one row, written back in bulk. */
export interface RowEvaluation {
  id: string;
  status: ImportRowStatus;
  occurredOn: Date | null;
  amountMinor: bigint | null;
  direction: StatementDirection | null;
  description: string;
  reference: string | null;
  counterparty: string | null;
  descriptionKey: string | null;
  problems: unknown;
  warnings: unknown;
  proposal: unknown;
  duplicates: unknown;
  duplicateDismissed: boolean;
}

export interface BatchChange {
  status?: StatementImport['status'];
  settings?: Prisma.InputJsonValue;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  openingBalanceMinor?: bigint | null;
  closingBalanceMinor?: bigint | null;
  reconciledAt?: Date | null;
  reconciliationDifferenceMinor?: bigint | null;
  adjustmentTransactionId?: string | null;
  completedAt?: Date;
  cancelledAt?: Date;
}

export interface RowChange {
  status?: ImportRowStatus;
  proposal?: Prisma.InputJsonValue;
  duplicateDismissed?: boolean;
  matchedTransactionId?: string | null;
  importedTransactionId?: string | null;
  error?: string | null;
}

/** A transaction as duplicate detection sees it. */
export type LedgerRecord = Pick<
  Transaction,
  | 'id'
  | 'type'
  | 'accountId'
  | 'transferAccountId'
  | 'adjustmentDirection'
  | 'amountMinor'
  | 'currency'
  | 'occurredAt'
  | 'description'
  | 'merchant'
  | 'voidedAt'
>;

export interface PriorImportRecord {
  batchId: string;
  fileName: string;
  occurredOn: Date;
  amountMinor: bigint;
  direction: StatementDirection;
  reference: string | null;
  descriptionKey: string | null;
  transaction: LedgerRecord;
}

export interface Suggestion {
  descriptionKey: string;
  categoryId: string;
  merchant: string | null;
}

/** Operations inside one database transaction (a batch write or a linked ledger write). */
export interface ImportStore {
  lockBatch: (userId: string, batchId: string) => Promise<BatchRecord | null>;
  lockRow: (userId: string, batchId: string, rowId: string) => Promise<RowRecord | null>;
  rows: (batchId: string) => Promise<RowRecord[]>;
  updateBatch: (batchId: string, change: BatchChange) => Promise<void>;
  updateRow: (rowId: string, change: RowChange) => Promise<void>;
  writeEvaluations: (batchId: string, rows: readonly RowEvaluation[]) => Promise<void>;
  clearCells: (batchId: string) => Promise<void>;
}

export interface ImportsRepository {
  findAccount: (userId: string, accountId: string) => Promise<Account | null>;
  findCategory: (userId: string, categoryId: string) => Promise<Category | null>;
  createBatch: (
    userId: string,
    batch: NewBatch,
    rows: readonly string[][],
    firstRowNumber: number,
  ) => Promise<string>;
  findBatch: (userId: string, batchId: string) => Promise<BatchWithAccount | null>;
  listBatches: (userId: string) => Promise<BatchWithAccount[]>;
  rowCounts: (batchIds: readonly string[]) => Promise<Map<string, Map<ImportRowStatus, number>>>;
  rowDates: (batchIds: readonly string[]) => Promise<Map<string, { from: Date; to: Date }>>;
  sampleRows: (batchId: string, count: number) => Promise<string[][]>;
  allRows: (batchId: string) => Promise<RowRecord[]>;
  pageRows: (
    batchId: string,
    statuses: readonly ImportRowStatus[] | undefined,
    page: number,
  ) => Promise<{ rows: RowRecord[]; total: number }>;
  findRow: (userId: string, batchId: string, rowId: string) => Promise<RowRecord | null>;
  findRows: (userId: string, batchId: string, rowIds: readonly string[]) => Promise<RowRecord[]>;
  /** Transactions already tied to a statement row: imported anywhere, or matched in an open or finished import. */
  linkedTransactionIds: (
    userId: string,
    accountId: string,
    exceptBatchId: string,
  ) => Promise<Set<string>>;
  priorImports: (
    userId: string,
    accountId: string,
    exceptBatchId: string,
    from: Date,
    to: Date,
  ) => Promise<PriorImportRecord[]>;
  ledger: (
    userId: string,
    accountId: string,
    currency: string,
    from: Date,
    to: Date,
  ) => Promise<LedgerRecord[]>;
  findTransaction: (userId: string, transactionId: string) => Promise<LedgerRecord | null>;
  /** Categories and merchants of the most recent imports of each recognised description. */
  suggestions: (userId: string, accountId: string) => Promise<Suggestion[]>;
  /**
   * The account's balance at an instant (transactions with `occurred_at` up to it), from the same
   * ledger query and balance arithmetic as every other balance, and when its counting starts.
   */
  ledgerBalance: (
    userId: string,
    account: Pick<Account, 'id' | 'openingBalanceMinor'>,
    asOf: Date,
  ) => Promise<{ balanceMinor: bigint; countsFrom: Date }>;
  inBatchWrite: <T>(work: (store: ImportStore) => Promise<T>) => Promise<T>;
  storeFor: (db: LinkedWriteClient) => ImportStore;
}

const idRow = z.object({ id: z.string() });
const EVALUATION_CHUNK = 500;

const LEDGER_SELECT = {
  id: true,
  type: true,
  accountId: true,
  transferAccountId: true,
  adjustmentDirection: true,
  amountMinor: true,
  currency: true,
  occurredAt: true,
  description: true,
  merchant: true,
  voidedAt: true,
} satisfies Prisma.TransactionSelect;

function createStore(tx: Prisma.TransactionClient): ImportStore {
  return {
    lockBatch: async (userId, batchId) => {
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM statement_imports
        WHERE user_id = ${userId}::uuid AND id = ${batchId}::uuid
        FOR UPDATE`;
      const [row] = z.array(idRow).parse(rows);
      return row === undefined ? null : tx.statementImport.findUnique({ where: { id: row.id } });
    },

    lockRow: async (userId, batchId, rowId) => {
      const rows: unknown = await tx.$queryRaw`
        SELECT id::text AS "id" FROM statement_import_rows
        WHERE user_id = ${userId}::uuid AND batch_id = ${batchId}::uuid AND id = ${rowId}::uuid
        FOR UPDATE`;
      const [row] = z.array(idRow).parse(rows);
      return row === undefined ? null : tx.statementImportRow.findUnique({ where: { id: row.id } });
    },

    rows: (batchId) =>
      tx.statementImportRow.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } }),

    updateBatch: async (batchId, change) => {
      await tx.statementImport.update({ where: { id: batchId }, data: change });
    },

    updateRow: async (rowId, change) => {
      await tx.statementImportRow.update({ where: { id: rowId }, data: change });
    },

    writeEvaluations: async (batchId, rows) => {
      for (let start = 0; start < rows.length; start += EVALUATION_CHUNK) {
        const chunk = rows.slice(start, start + EVALUATION_CHUNK);
        const column = <T>(pick: (row: RowEvaluation) => T): T[] => chunk.map(pick);
        // Optional values travel as text ('' for NULL), so the arrays never contain NULL elements.
        await tx.$executeRaw`
          UPDATE statement_import_rows AS r SET
            status = u.status::import_row_status,
            occurred_on = NULLIF(u.occurred_on, '')::date,
            amount_minor = NULLIF(u.amount_minor, '')::bigint,
            direction = NULLIF(u.direction, '')::statement_direction,
            description = u.description,
            reference = NULLIF(u.reference, ''),
            counterparty = NULLIF(u.counterparty, ''),
            description_key = NULLIF(u.description_key, ''),
            problems = u.problems::jsonb,
            warnings = u.warnings::jsonb,
            proposal = NULLIF(u.proposal, '')::jsonb,
            duplicates = u.duplicates::jsonb,
            duplicate_dismissed = u.duplicate_dismissed,
            error = NULL,
            updated_at = now()
          FROM unnest(
            ${column((row) => row.id)}::uuid[],
            ${column((row) => row.status)}::text[],
            ${column((row) => (row.occurredOn === null ? '' : row.occurredOn.toISOString().slice(0, 10)))}::text[],
            ${column((row) => (row.amountMinor === null ? '' : row.amountMinor.toString()))}::text[],
            ${column((row) => row.direction ?? '')}::text[],
            ${column((row) => row.description)}::text[],
            ${column((row) => row.reference ?? '')}::text[],
            ${column((row) => row.counterparty ?? '')}::text[],
            ${column((row) => row.descriptionKey ?? '')}::text[],
            ${column((row) => JSON.stringify(row.problems))}::text[],
            ${column((row) => JSON.stringify(row.warnings))}::text[],
            ${column((row) => (row.proposal === null ? '' : JSON.stringify(row.proposal)))}::text[],
            ${column((row) => JSON.stringify(row.duplicates))}::text[],
            ${column((row) => row.duplicateDismissed)}::boolean[]
          ) AS u(id, status, occurred_on, amount_minor, direction, description, reference,
                 counterparty, description_key, problems, warnings, proposal, duplicates,
                 duplicate_dismissed)
          WHERE r.id = u.id AND r.batch_id = ${batchId}::uuid
            AND r.status NOT IN ('matched', 'imported')`;
      }
    },

    clearCells: async (batchId) => {
      await tx.statementImportRow.updateMany({ where: { batchId }, data: { cells: [] } });
    },
  };
}

export function createPrismaImportsRepository(prisma: PrismaClient): ImportsRepository {
  return {
    findAccount: (userId, accountId) =>
      prisma.account.findFirst({ where: { id: accountId, userId } }),

    findCategory: (userId, categoryId) =>
      prisma.category.findFirst({ where: { id: categoryId, userId } }),

    createBatch: (userId, batch, rows, firstRowNumber) =>
      prisma.$transaction(
        async (tx) => {
          const created = await tx.statementImport.create({ data: { ...batch, userId } });
          await tx.statementImportRow.createMany({
            data: rows.map((cells, index) => ({
              userId,
              batchId: created.id,
              rowNumber: firstRowNumber + index,
              cells,
              status: 'invalid' as const,
              problems: [{ field: 'row', message: 'Confirm how the columns are read first.' }],
              createdAt: batch.createdAt,
            })),
          });
          return created.id;
        },
        { timeout: 30_000 },
      ),

    findBatch: (userId, batchId) =>
      prisma.statementImport.findFirst({
        where: { id: batchId, userId },
        include: { account: true },
      }),

    listBatches: (userId) =>
      prisma.statementImport.findMany({
        where: { userId },
        include: { account: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_IMPORT_BATCHES_LISTED,
      }),

    rowCounts: async (batchIds) => {
      const groups =
        batchIds.length === 0
          ? []
          : await prisma.statementImportRow.groupBy({
              by: ['batchId', 'status'],
              where: { batchId: { in: [...batchIds] } },
              _count: { _all: true },
            });
      const counts = new Map<string, Map<ImportRowStatus, number>>();
      for (const group of groups) {
        const entry = counts.get(group.batchId) ?? new Map<ImportRowStatus, number>();
        entry.set(group.status, group._count._all);
        counts.set(group.batchId, entry);
      }
      return counts;
    },

    rowDates: async (batchIds) => {
      const groups =
        batchIds.length === 0
          ? []
          : await prisma.statementImportRow.groupBy({
              by: ['batchId'],
              where: { batchId: { in: [...batchIds] }, occurredOn: { not: null } },
              _min: { occurredOn: true },
              _max: { occurredOn: true },
            });
      return new Map(
        groups.flatMap((group) =>
          group._min.occurredOn === null || group._max.occurredOn === null
            ? []
            : [
                [
                  group.batchId,
                  { from: group._min.occurredOn, to: group._max.occurredOn },
                ] as const,
              ],
        ),
      );
    },

    sampleRows: async (batchId, count) =>
      (
        await prisma.statementImportRow.findMany({
          where: { batchId },
          select: { cells: true },
          orderBy: { rowNumber: 'asc' },
          take: count,
        })
      ).map((row) => row.cells),

    allRows: (batchId) =>
      prisma.statementImportRow.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } }),

    pageRows: async (batchId, statuses, page) => {
      const where: Prisma.StatementImportRowWhereInput = {
        batchId,
        ...(statuses === undefined ? {} : { status: { in: [...statuses] } }),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.statementImportRow.findMany({
          where,
          orderBy: { rowNumber: 'asc' },
          skip: (page - 1) * IMPORT_ROWS_PAGE_SIZE,
          take: IMPORT_ROWS_PAGE_SIZE,
        }),
        prisma.statementImportRow.count({ where }),
      ]);
      return { rows, total };
    },

    findRow: (userId, batchId, rowId) =>
      prisma.statementImportRow.findFirst({ where: { id: rowId, batchId, userId } }),

    findRows: (userId, batchId, rowIds) =>
      prisma.statementImportRow.findMany({
        where: { userId, batchId, id: { in: [...rowIds] } },
        orderBy: { rowNumber: 'asc' },
      }),

    linkedTransactionIds: async (userId, accountId, exceptBatchId) => {
      const rows = await prisma.statementImportRow.findMany({
        where: {
          userId,
          batchId: { not: exceptBatchId },
          batch: { accountId },
          OR: [
            { status: 'imported' },
            { status: 'matched', batch: { status: { not: 'cancelled' } } },
          ],
        },
        select: { importedTransactionId: true, matchedTransactionId: true },
      });
      const ids = new Set<string>();
      for (const row of rows) {
        if (row.importedTransactionId !== null) ids.add(row.importedTransactionId);
        if (row.matchedTransactionId !== null) ids.add(row.matchedTransactionId);
      }
      return ids;
    },

    priorImports: async (userId, accountId, exceptBatchId, from, to) => {
      const rows = await prisma.statementImportRow.findMany({
        where: {
          userId,
          batchId: { not: exceptBatchId },
          batch: { accountId },
          occurredOn: { gte: from, lte: to },
          OR: [
            { status: 'imported', importedTransaction: { voidedAt: null } },
            {
              status: 'matched',
              batch: { status: { not: 'cancelled' } },
              matchedTransaction: { voidedAt: null },
            },
          ],
        },
        include: {
          batch: { select: { fileName: true } },
          importedTransaction: { select: LEDGER_SELECT },
          matchedTransaction: { select: LEDGER_SELECT },
        },
        take: 20_000,
      });
      return rows.flatMap((row) => {
        const transaction = row.importedTransaction ?? row.matchedTransaction;
        return transaction === null ||
          row.occurredOn === null ||
          row.amountMinor === null ||
          row.direction === null
          ? []
          : [
              {
                batchId: row.batchId,
                fileName: row.batch.fileName,
                occurredOn: row.occurredOn,
                amountMinor: row.amountMinor,
                direction: row.direction,
                reference: row.reference,
                descriptionKey: row.descriptionKey,
                transaction,
              },
            ];
      });
    },

    ledger: (userId, accountId, currency, from, to) =>
      prisma.transaction.findMany({
        where: {
          userId,
          currency,
          voidedAt: null,
          occurredAt: { gte: from, lt: to },
          OR: [{ accountId }, { transferAccountId: accountId }],
        },
        select: LEDGER_SELECT,
        orderBy: { occurredAt: 'asc' },
        take: 20_000,
      }),

    findTransaction: (userId, transactionId) =>
      prisma.transaction.findFirst({ where: { id: transactionId, userId }, select: LEDGER_SELECT }),

    suggestions: async (userId, accountId) => {
      const rows: unknown = await prisma.$queryRaw`
        SELECT DISTINCT ON (r.description_key)
               r.description_key AS "descriptionKey",
               t.category_id::text AS "categoryId",
               t.merchant AS "merchant"
        FROM statement_import_rows r
        JOIN statement_imports b ON b.id = r.batch_id
        JOIN transactions t ON t.id = r.imported_transaction_id
        JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
        WHERE r.user_id = ${userId}::uuid AND b.account_id = ${accountId}::uuid
          AND r.status = 'imported' AND r.description_key IS NOT NULL
          AND t.voided_at IS NULL AND c.archived_at IS NULL
        ORDER BY r.description_key, t.occurred_at DESC
        LIMIT 5000`;
      return z
        .array(
          z.object({
            descriptionKey: z.string(),
            categoryId: z.string(),
            merchant: z.string().nullable(),
          }),
        )
        .parse(rows);
    },

    ledgerBalance: async (userId, account, asOf) => {
      const countsFrom = (await readCountsFrom(prisma, userId, [account.id])).get(account.id);
      if (countsFrom === undefined) {
        throw new Error('Account not found.');
      }
      const totals =
        (await queryMovementTotals(prisma, userId, { accountIds: [account.id], asOf })).get(
          account.id,
        ) ?? NO_MOVEMENTS;
      return {
        balanceMinor: calculateCurrentBalance(account.openingBalanceMinor, totals),
        countsFrom,
      };
    },

    inBatchWrite: (work) =>
      prisma.$transaction((tx) => work(createStore(tx)), { maxWait: 10_000, timeout: 30_000 }),

    storeFor: (db) => createStore(db),
  };
}
