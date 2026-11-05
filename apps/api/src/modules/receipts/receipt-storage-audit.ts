import type { PrismaClient } from '../../generated/prisma/client';
import type { FileStorage } from '../../lib/file-storage';

// Compares private receipt storage with the receipt rows that reference it.
//
// - Orphans: stored files no receipt references. An upload writes the file before the row, and a
//   delete removes the row before the file, so a crash in between leaves one. Only files older
//   than the grace period count (an upload in progress is never touched), and each is re-checked
//   against the database immediately before it is removed.
// - Missing: receipt rows whose file is gone (e.g. after restoring a database backup without the
//   matching files). They are reported, never changed: the person still sees the receipt listed
//   and gets a clear "file missing" answer when opening it.
//
// Reports contain counts and receipt IDs only — no file names, owners, or contents.

export const DEFAULT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const SAMPLE = 20;

export interface ReceiptStorageAuditOptions {
  prisma: PrismaClient;
  storage: FileStorage;
  now?: Date;
  /** Files younger than this are never treated as orphans. */
  graceMs?: number;
  /** Remove orphans (default: report only). */
  deleteOrphans?: boolean;
}

export interface ReceiptStorageAuditReport {
  storedFiles: number;
  referencedFiles: number;
  /** Unreferenced files older than the grace period. */
  orphans: number;
  /** Unreferenced files within the grace period (possibly an upload in progress). */
  recentUnreferenced: number;
  orphansDeleted: number;
  orphanDeleteFailures: number;
  /** Receipt rows whose file is not in storage. */
  missingFiles: number;
  /** Up to 20 receipt IDs with a missing file, for follow-up. */
  missingReceiptIds: string[];
}

export async function auditReceiptStorage({
  prisma,
  storage,
  now = new Date(),
  graceMs = DEFAULT_ORPHAN_GRACE_MS,
  deleteOrphans = false,
}: ReceiptStorageAuditOptions): Promise<ReceiptStorageAuditReport> {
  const report: ReceiptStorageAuditReport = {
    storedFiles: 0,
    referencedFiles: 0,
    orphans: 0,
    recentUnreferenced: 0,
    orphansDeleted: 0,
    orphanDeleteFailures: 0,
    missingFiles: 0,
    missingReceiptIds: [],
  };
  const cutoff = now.getTime() - graceMs;
  // Every stored key, to find rows without a file afterwards (32 bytes each: a million receipts
  // need about 100 MB here; run the audit on a machine sized for the store).
  const stored = new Set<string>();

  const referenced = async (keys: readonly string[]): Promise<Set<string>> =>
    new Set(
      (
        await prisma.transactionReceipt.findMany({
          where: { storageKey: { in: [...keys] } },
          select: { storageKey: true },
        })
      ).map((row) => row.storageKey),
    );

  const settle = async (batch: { key: string; storedAt: Date }[]): Promise<void> => {
    const known = await referenced(batch.map((file) => file.key));
    for (const file of batch) {
      if (known.has(file.key)) {
        report.referencedFiles += 1;
        continue;
      }
      if (file.storedAt.getTime() > cutoff) {
        report.recentUnreferenced += 1;
        continue;
      }
      report.orphans += 1;
      if (!deleteOrphans) continue;
      // Re-check right before removing: never delete a file a receipt now references.
      if ((await referenced([file.key])).size > 0) {
        report.orphans -= 1;
        report.referencedFiles += 1;
        continue;
      }
      try {
        await storage.remove(file.key);
        report.orphansDeleted += 1;
      } catch {
        report.orphanDeleteFailures += 1;
      }
    }
  };

  let batch: { key: string; storedAt: Date }[] = [];
  for await (const file of storage.list()) {
    report.storedFiles += 1;
    stored.add(file.key);
    batch.push(file);
    if (batch.length >= BATCH) {
      await settle(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await settle(batch);

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.transactionReceipt.findMany({
      // Receipts added while the files were being listed are not judged.
      where: { createdAt: { lt: now } },
      select: { id: true, storageKey: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    for (const row of rows) {
      if (stored.has(row.storageKey)) continue;
      report.missingFiles += 1;
      if (report.missingReceiptIds.length < SAMPLE) report.missingReceiptIds.push(row.id);
    }
    if (rows.length < BATCH) break;
    cursor = rows.at(-1)?.id;
  }
  return report;
}
