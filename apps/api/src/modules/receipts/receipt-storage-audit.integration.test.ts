import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { API_V1_PREFIX, apiSuccessResponseSchema, receiptDtoSchema } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { createLocalFileStorage, newStorageKey } from '../../lib/file-storage';
import { categoryId, createAccount, newUser, record } from '../../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';
import { RECEIPT_SAMPLES } from '../../testing/receipt-samples';
import { auditReceiptStorage } from './receipt-storage-audit';

const { prisma, createContext } = useIntegrationDatabase();
const DAY_MS = 24 * 60 * 60 * 1000;

async function withReceipts(
  count: number,
): Promise<{ context: TestContext; user: SignedIn; receiptIds: string[] }> {
  const context = createContext();
  const user = await newUser(context);
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '100000',
      openingBalanceDate: '2026-09-01',
    })
  ).account.id;
  const transaction = await record(user, {
    type: 'expense',
    accountId: bank,
    amountMinor: '45000',
    occurredAt: '2026-10-05T06:00:00.000Z',
    description: 'Dinner',
    categoryId: await categoryId(user, 'expense', 'Restaurants'),
  });
  const receiptIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const response = await withCsrf(
      user.agent.post(
        `${API_V1_PREFIX}/transactions/${transaction.transaction.id}/receipts?fileName=r${String(index)}.png`,
      ),
      user,
    )
      .set('Content-Type', 'image/png')
      .send(Buffer.from(RECEIPT_SAMPLES.png));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    receiptIds.push(apiSuccessResponseSchema(receiptDtoSchema).parse(response.body).data.id);
  }
  return { context, user, receiptIds };
}

describe('receipt storage audit', () => {
  it('finds orphans past the grace period and files missing from storage', async () => {
    const { context, receiptIds } = await withReceipts(3);
    const storage = context.storage;
    const now = new Date(Date.now() + 60_000);
    // A crash between writing the file and saving its row, long ago and just now.
    const oldOrphan = newStorageKey();
    const recentOrphan = newStorageKey();
    await storage.put(oldOrphan, RECEIPT_SAMPLES.png);
    await storage.put(recentOrphan, RECEIPT_SAMPLES.png);
    storage.backdate(oldOrphan, new Date(now.getTime() - 2 * DAY_MS));
    // A restored database whose file did not come back.
    const [lost] = receiptIds;
    if (lost === undefined) throw new Error('No receipt uploaded.');
    const lostRow = await prisma.transactionReceipt.findUniqueOrThrow({ where: { id: lost } });
    await storage.remove(lostRow.storageKey);

    const dryRun = await auditReceiptStorage({ prisma, storage, now });

    expect(dryRun).toEqual({
      storedFiles: 4,
      referencedFiles: 2,
      orphans: 1,
      recentUnreferenced: 1,
      orphansDeleted: 0,
      orphanDeleteFailures: 0,
      missingFiles: 1,
      missingReceiptIds: [lost],
    });
    expect(storage.keys()).toContain(oldOrphan); // Report only.

    const cleanup = await auditReceiptStorage({ prisma, storage, now, deleteOrphans: true });
    expect(cleanup.orphansDeleted).toBe(1);
    expect(storage.keys()).not.toContain(oldOrphan);
    // The recent file and every referenced file are untouched; the missing row is only reported.
    expect(storage.keys()).toContain(recentOrphan);
    expect(storage.keys()).toHaveLength(3);
    expect(await prisma.transactionReceipt.count()).toBe(3);
  });

  it('counts a failed removal instead of stopping', async () => {
    const { context } = await withReceipts(1);
    const orphan = newStorageKey();
    await context.storage.put(orphan, RECEIPT_SAMPLES.png);
    context.storage.backdate(orphan, new Date(Date.now() - 2 * DAY_MS));
    const failing = {
      ...context.storage,
      remove: (): Promise<void> => Promise.reject(new Error('storage unavailable')),
    };

    const report = await auditReceiptStorage({ prisma, storage: failing, deleteOrphans: true });

    expect(report).toMatchObject({ orphans: 1, orphansDeleted: 0, orphanDeleteFailures: 1 });
    expect(context.storage.keys()).toContain(orphan);
  });

  it('lists only receipt files from a local directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'calmcash-audit-'));
    try {
      const storage = createLocalFileStorage(root);
      const key = newStorageKey();
      await storage.put(key, RECEIPT_SAMPLES.png);
      const old = new Date(Date.now() - 3 * DAY_MS);
      await utimes(join(root, key.slice(0, 2), key), old, old);
      // Foreign files are never treated as receipts (or deleted).
      await writeFile(join(root, 'README.txt'), 'not a receipt');
      await mkdir(join(root, 'zz'));
      await writeFile(join(root, 'zz', 'notes'), 'not a receipt');

      const listed = [];
      for await (const file of storage.list()) listed.push(file);
      expect(listed.map((file) => file.key)).toEqual([key]);

      const report = await auditReceiptStorage({ prisma, storage, deleteOrphans: true });
      expect(report).toMatchObject({ storedFiles: 1, orphans: 1, orphansDeleted: 1 });
      const after = [];
      for await (const file of storage.list()) after.push(file);
      expect(after).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
