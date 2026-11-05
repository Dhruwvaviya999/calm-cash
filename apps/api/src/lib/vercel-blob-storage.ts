import { del, get, list, put } from '@vercel/blob';

import { isStorageKey, StoredFileMissingError, type FileStorage } from './file-storage';

/** Private blobs keep the same random keys and ownership checks as local receipt storage. */
export function createVercelBlobFileStorage(token: string): FileStorage {
  const pathOf = (key: string): string => {
    if (!isStorageKey(key)) throw new Error('Invalid storage key.');
    return `receipts/${key.slice(0, 2)}/${key}`;
  };

  return {
    put: async (key, content) => {
      await put(pathOf(key), Buffer.from(content), {
        access: 'private',
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/octet-stream',
      });
    },
    read: async (key) => {
      const result = await get(pathOf(key), { access: 'private', token, useCache: false });
      if (result === null) throw new StoredFileMissingError('The stored file is missing.');
      if (result.statusCode !== 200) throw new Error('Unexpected receipt storage response.');
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    remove: async (key) => {
      // Blob deletion, like the local adapter, succeeds when the object is already absent.
      await del(pathOf(key), { token });
    },
    list: async function* () {
      let cursor: string | undefined;
      do {
        const page = await list({
          prefix: 'receipts/',
          limit: 1000,
          token,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const blob of page.blobs) {
          const key = blob.pathname.split('/').at(-1) ?? '';
          // Only `receipts/<shard>/<key>` objects are receipts; anything else is left alone.
          if (isStorageKey(key) && blob.pathname === pathOf(key)) {
            yield { key, storedAt: blob.uploadedAt };
          }
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor !== undefined);
    },
  };
}
