import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Private file storage for uploaded documents (receipts). Files are addressed only by random,
// server-generated keys — never by anything a person typed — so a file name cannot reach the
// filesystem, and the same key is never written twice. Application code depends on the
// `FileStorage` interface; a private object-storage adapter can replace the local one later.

/** 32 lower-case hex characters (128 random bits). */
const STORAGE_KEY = /^[0-9a-f]{32}$/;

export interface FileStorage {
  /** Stores new content under `key`; refuses to overwrite an existing file. */
  put: (key: string, content: Uint8Array) => Promise<void>;
  /** The stored content; throws `StoredFileMissingError` when it is gone. */
  read: (key: string) => Promise<Buffer>;
  /** Removes the file; succeeds when it is already gone. */
  remove: (key: string) => Promise<void>;
}

export class StoredFileMissingError extends Error {
  override readonly name = 'StoredFileMissingError';
}

export function newStorageKey(): string {
  return randomBytes(16).toString('hex');
}

export function isStorageKey(key: string): boolean {
  return STORAGE_KEY.test(key);
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/**
 * Files under `root`, sharded by the key's first two characters. `root` must be outside anything
 * a web server publishes, and on a persistent volume in production.
 */
export function createLocalFileStorage(root: string): FileStorage {
  const base = resolve(root);
  const pathOf = (key: string): string => {
    if (!isStorageKey(key)) {
      throw new Error('Invalid storage key.');
    }
    const path = join(base, key.slice(0, 2), key);
    // Defence in depth: a valid key can never leave the root, but check the resolved path anyway.
    if (!path.startsWith(`${base}${sep}`)) {
      throw new Error('Invalid storage key.');
    }
    return path;
  };

  return {
    put: async (key, content) => {
      const path = pathOf(key);
      await mkdir(join(base, key.slice(0, 2)), { recursive: true, mode: 0o700 });
      // `wx`: fail instead of overwriting; owner-only permissions where the platform supports them.
      await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    },
    read: async (key) => {
      try {
        return await readFile(pathOf(key));
      } catch (error: unknown) {
        if (hasCode(error, 'ENOENT')) {
          throw new StoredFileMissingError('The stored file is missing.', { cause: error });
        }
        throw error;
      }
    },
    remove: async (key) => {
      await rm(pathOf(key), { force: true });
    },
  };
}
