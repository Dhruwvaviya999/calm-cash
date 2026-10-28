import type { PrismaClient, Prisma, TransactionReceipt } from '../../generated/prisma/client';

// Receipt metadata. Every query is scoped by the owner's user ID. Writes for one transaction are
// serialised with a transaction-scoped advisory lock, so the per-transaction limit holds even when
// several uploads arrive at once; the transaction row itself is not locked, so receipts never
// delay ledger writes.

export type ReceiptRecord = TransactionReceipt;

export interface ReceiptTransaction {
  id: string;
  /** True when the transaction touches an archived account (it is read-only then). */
  readOnly: boolean;
}

export interface NewReceipt {
  transactionId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}

export interface ReceiptStore {
  count: (transactionId: string) => Promise<number>;
  create: (userId: string, receipt: NewReceipt) => Promise<ReceiptRecord>;
  find: (userId: string, transactionId: string, receiptId: string) => Promise<ReceiptRecord | null>;
  delete: (receiptId: string) => Promise<void>;
}

export interface ReceiptsRepository {
  findTransaction: (userId: string, transactionId: string) => Promise<ReceiptTransaction | null>;
  list: (userId: string, transactionId: string) => Promise<ReceiptRecord[]>;
  find: (userId: string, transactionId: string, receiptId: string) => Promise<ReceiptRecord | null>;
  /** Runs `work` in one database transaction holding the transaction's receipt lock. */
  inReceiptWrite: <T>(
    transactionId: string,
    work: (store: ReceiptStore) => Promise<T>,
  ) => Promise<T>;
}

function createStore(tx: Prisma.TransactionClient): ReceiptStore {
  return {
    count: (transactionId) => tx.transactionReceipt.count({ where: { transactionId } }),
    create: (userId, receipt) => tx.transactionReceipt.create({ data: { ...receipt, userId } }),
    find: (userId, transactionId, receiptId) =>
      tx.transactionReceipt.findFirst({ where: { id: receiptId, transactionId, userId } }),
    delete: async (receiptId) => {
      await tx.transactionReceipt.delete({ where: { id: receiptId } });
    },
  };
}

export function createPrismaReceiptsRepository(prisma: PrismaClient): ReceiptsRepository {
  return {
    findTransaction: async (userId, transactionId) => {
      const transaction = await prisma.transaction.findFirst({
        where: { id: transactionId, userId },
        select: {
          id: true,
          account: { select: { archivedAt: true } },
          transferAccount: { select: { archivedAt: true } },
        },
      });
      return transaction === null
        ? null
        : {
            id: transaction.id,
            readOnly:
              transaction.account.archivedAt !== null ||
              (transaction.transferAccount?.archivedAt ?? null) !== null,
          };
    },

    list: (userId, transactionId) =>
      prisma.transactionReceipt.findMany({
        where: { userId, transactionId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),

    find: (userId, transactionId, receiptId) =>
      prisma.transactionReceipt.findFirst({ where: { id: receiptId, transactionId, userId } }),

    inReceiptWrite: (transactionId, work) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`receipts:${transactionId}`}, 0))`;
        return work(createStore(tx));
      }),
  };
}
