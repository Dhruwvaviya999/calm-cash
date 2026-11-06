import { isStorageKey, StoredFileMissingError, type FileStorage } from '../lib/file-storage';

/** File storage kept in memory for tests; `keys()` shows what is stored. */
export interface InMemoryFileStorage extends FileStorage {
  keys: () => string[];
  /** Pretends a file was written at another time (orphan grace-period tests). */
  backdate: (key: string, storedAt: Date) => void;
}

export function createInMemoryFileStorage(): InMemoryFileStorage {
  const files = new Map<string, { content: Buffer; storedAt: Date }>();
  return {
    put: (key, content) => {
      if (!isStorageKey(key)) return Promise.reject(new Error('Invalid storage key.'));
      if (files.has(key)) return Promise.reject(new Error('The file already exists.'));
      files.set(key, { content: Buffer.from(content), storedAt: new Date() });
      return Promise.resolve();
    },
    read: (key) => {
      const file = files.get(key);
      return file === undefined
        ? Promise.reject(new StoredFileMissingError('The stored file is missing.'))
        : Promise.resolve(Buffer.from(file.content));
    },
    remove: (key) => {
      files.delete(key);
      return Promise.resolve();
    },
    list: async function* () {
      await Promise.resolve();
      for (const [key, { storedAt }] of files) yield { key, storedAt };
    },
    keys: () => [...files.keys()],
    backdate: (key, storedAt) => {
      const file = files.get(key);
      if (file !== undefined) file.storedAt = storedAt;
    },
  };
}
