import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalFileStorage,
  isStorageKey,
  newStorageKey,
  StoredFileMissingError,
} from '../../lib/file-storage';
import { RECEIPT_SAMPLES } from '../../testing/receipt-samples';
import { detectReceiptType } from './file-signature';
import { contentDisposition } from './receipts.routes';

describe('detectReceiptType', () => {
  it('recognises JPEG, PNG, WebP, and PDF by content', () => {
    expect(detectReceiptType(RECEIPT_SAMPLES.jpeg)).toBe('image/jpeg');
    expect(detectReceiptType(RECEIPT_SAMPLES.png)).toBe('image/png');
    expect(detectReceiptType(RECEIPT_SAMPLES.webp)).toBe('image/webp');
    expect(detectReceiptType(RECEIPT_SAMPLES.pdf)).toBe('application/pdf');
  });

  it('refuses other content, truncated files, and disguises', () => {
    expect(
      detectReceiptType(new TextEncoder().encode('<html><script>alert(1)</script></html>')),
    ).toBeUndefined();
    expect(detectReceiptType(RECEIPT_SAMPLES.png.subarray(0, 30))).toBeUndefined();
    expect(detectReceiptType(RECEIPT_SAMPLES.pdf.subarray(0, 20))).toBeUndefined();
    expect(detectReceiptType(RECEIPT_SAMPLES.jpeg.subarray(0, 10))).toBeUndefined();
    expect(detectReceiptType(new Uint8Array())).toBeUndefined();
  });
});

describe('local file storage', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it('stores files under random keys, never overwrites, and refuses other keys', async () => {
    root = await mkdtemp(join(tmpdir(), 'calmcash-storage-'));
    const storage = createLocalFileStorage(root);
    const key = newStorageKey();
    expect(isStorageKey(key)).toBe(true);
    await storage.put(key, RECEIPT_SAMPLES.png);
    expect(await storage.read(key)).toEqual(Buffer.from(RECEIPT_SAMPLES.png));
    await expect(storage.put(key, RECEIPT_SAMPLES.jpeg)).rejects.toThrow();
    await expect(storage.put('../../etc/passwd', RECEIPT_SAMPLES.png)).rejects.toThrow(
      'Invalid storage key.',
    );
    await expect(storage.read('..%2F..%2Fsecret')).rejects.toThrow('Invalid storage key.');
    await storage.remove(key);
    await storage.remove(key); // Already gone: still fine.
    await expect(storage.read(key)).rejects.toBeInstanceOf(StoredFileMissingError);
    expect(await readdir(join(root, key.slice(0, 2)))).toEqual([]);
  });
});

describe('contentDisposition', () => {
  it('keeps an ASCII fallback and the exact name, escaping quotes and path characters', () => {
    expect(contentDisposition('attachment', 'bill "final".pdf')).toBe(
      `attachment; filename="bill _final_.pdf"; filename*=UTF-8''bill%20%22final%22.pdf`,
    );
    expect(contentDisposition('inline', 'रसीद.png')).toContain("filename*=UTF-8''%E0%A4");
  });
});
