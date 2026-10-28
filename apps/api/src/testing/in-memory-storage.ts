import { isStorageKey, StoredFileMissingError, type FileStorage } from '../lib/file-storage';

/** File storage kept in memory for tests; `keys()` shows what is stored. */
export interface InMemoryFileStorage extends FileStorage {
  keys: () => string[];
}

export function createInMemoryFileStorage(): InMemoryFileStorage {
  const files = new Map<string, Buffer>();
  return {
    put: (key, content) => {
      if (!isStorageKey(key)) return Promise.reject(new Error('Invalid storage key.'));
      if (files.has(key)) return Promise.reject(new Error('The file already exists.'));
      files.set(key, Buffer.from(content));
      return Promise.resolve();
    },
    read: (key) => {
      const content = files.get(key);
      return content === undefined
        ? Promise.reject(new StoredFileMissingError('The stored file is missing.'))
        : Promise.resolve(Buffer.from(content));
    },
    remove: (key) => {
      files.delete(key);
      return Promise.resolve();
    },
    keys: () => [...files.keys()],
  };
}
