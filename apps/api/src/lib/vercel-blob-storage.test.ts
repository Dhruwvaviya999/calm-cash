import { del, get, put } from '@vercel/blob';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoredFileMissingError } from './file-storage';
import { createVercelBlobFileStorage } from './vercel-blob-storage';

vi.mock('@vercel/blob', () => ({ del: vi.fn(), get: vi.fn(), put: vi.fn() }));

const KEY = '0123456789abcdef0123456789abcdef';
const PATH = `receipts/01/${KEY}`;
const TOKEN = 'test-private-store-token';

beforeEach(() => vi.resetAllMocks());

describe('private Blob receipt storage', () => {
  it('writes private, immutable blobs addressed only by validated random keys', async () => {
    const storage = createVercelBlobFileStorage(TOKEN);
    const content = Buffer.from('receipt');
    await storage.put(KEY, content);

    expect(put).toHaveBeenCalledWith(PATH, content, {
      access: 'private',
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/octet-stream',
    });
    vi.mocked(put).mockRejectedValueOnce(new Error('Already exists'));
    await expect(storage.put(KEY, content)).rejects.toThrow('Already exists');
  });

  it('reads authenticated content without using a cached copy', async () => {
    const content = new Uint8Array([137, 80, 78, 71]);
    const url = `https://test.private.blob.vercel-storage.com/${PATH}`;
    vi.mocked(get).mockResolvedValueOnce({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      }),
      headers: new Headers(),
      blob: {
        url,
        downloadUrl: url,
        pathname: PATH,
        contentDisposition: 'attachment',
        cacheControl: 'private',
        uploadedAt: new Date(),
        etag: 'test-etag',
        contentType: 'application/octet-stream',
        size: content.length,
      },
    });

    await expect(createVercelBlobFileStorage(TOKEN).read(KEY)).resolves.toEqual(
      Buffer.from(content),
    );
    expect(get).toHaveBeenCalledWith(PATH, { access: 'private', token: TOKEN, useCache: false });
  });

  it('maps a missing blob to the existing receipt-not-found behavior', async () => {
    vi.mocked(get).mockResolvedValueOnce(null);
    await expect(createVercelBlobFileStorage(TOKEN).read(KEY)).rejects.toBeInstanceOf(
      StoredFileMissingError,
    );
  });

  it('deletes using server credentials and rejects arbitrary paths before any SDK call', async () => {
    const storage = createVercelBlobFileStorage(TOKEN);
    await storage.remove(KEY);
    expect(del).toHaveBeenCalledWith(PATH, { token: TOKEN });
    vi.clearAllMocks();

    for (const key of ['../../secret', 'https://elsewhere.example/file', KEY.toUpperCase()]) {
      await expect(storage.put(key, new Uint8Array())).rejects.toThrow('Invalid storage key.');
      await expect(storage.read(key)).rejects.toThrow('Invalid storage key.');
      await expect(storage.remove(key)).rejects.toThrow('Invalid storage key.');
    }
    expect(put).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
