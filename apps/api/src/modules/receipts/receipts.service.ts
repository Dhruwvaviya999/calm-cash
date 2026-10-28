import { createHash } from 'node:crypto';

import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_TRANSACTION,
  RECEIPT_EXTENSIONS,
  receiptContentTypeSchema,
  type ReceiptContentType,
  type ReceiptDto,
  type ReceiptListDto,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { newStorageKey, StoredFileMissingError, type FileStorage } from '../../lib/file-storage';
import type { Logger } from '../../lib/logger';
import { detectReceiptType } from './file-signature';
import type { ReceiptRecord, ReceiptsRepository } from './receipts.repository';

export interface ReceiptFile {
  receipt: ReceiptDto;
  content: Buffer;
}

export interface ReceiptsService {
  list: (caller: Caller, transactionId: string) => Promise<ReceiptListDto>;
  upload: (
    caller: Caller,
    transactionId: string,
    file: { fileName: string; declaredType: string | undefined; content: Buffer },
  ) => Promise<ReceiptDto>;
  download: (caller: Caller, transactionId: string, receiptId: string) => Promise<ReceiptFile>;
  remove: (caller: Caller, transactionId: string, receiptId: string) => Promise<void>;
}

export interface ReceiptsServiceDependencies {
  repository: ReceiptsRepository;
  storage: FileStorage;
  logger: Logger;
  now: () => Date;
}

const transactionNotFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That transaction does not exist or is not yours.');
const receiptNotFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That receipt does not exist or is not yours.');

function refuse(message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, { details: [{ path: 'body', message }] });
}

const TYPE_NAMES: Readonly<Record<ReceiptContentType, string>> = {
  'image/jpeg': 'a JPEG image',
  'image/png': 'a PNG image',
  'image/webp': 'a WebP image',
  'application/pdf': 'a PDF',
};

/**
 * Only the error code is logged: filesystem error messages contain the storage path, which stays
 * out of logs like the file contents do.
 */
function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'unknown';
}

export function toReceiptDto(record: ReceiptRecord): ReceiptDto {
  return {
    id: record.id,
    transactionId: record.transactionId,
    fileName: record.fileName,
    contentType: receiptContentTypeSchema.parse(record.contentType),
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    createdAt: record.createdAt.toISOString(),
  };
}

export function createReceiptsService({
  repository,
  storage,
  logger,
  now,
}: ReceiptsServiceDependencies): ReceiptsService {
  /** The caller's transaction; `writable` refuses ones on archived accounts (they are read-only). */
  const transactionOf = async (
    caller: Caller,
    transactionId: string,
    writable: boolean,
  ): Promise<void> => {
    const transaction = await repository.findTransaction(caller.userId, transactionId);
    if (transaction === null) throw transactionNotFound();
    if (writable && transaction.readOnly) {
      throw new AppError(
        409,
        'CONFLICT',
        'This transaction belongs to an archived account. Restore the account to change its receipts.',
      );
    }
  };

  return {
    list: async (caller, transactionId) => {
      await transactionOf(caller, transactionId, false);
      return { receipts: (await repository.list(caller.userId, transactionId)).map(toReceiptDto) };
    },

    upload: async (caller, transactionId, { fileName, declaredType, content }) => {
      await transactionOf(caller, transactionId, true);
      if (content.length === 0) {
        throw refuse('Choose a receipt file.');
      }
      if (content.length > MAX_RECEIPT_BYTES) {
        throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Receipts can be at most 10 MB.');
      }
      const contentType = detectReceiptType(content);
      if (contentType === undefined) {
        throw refuse('This file is not a JPEG, PNG, WebP, or PDF receipt, or it is damaged.');
      }
      const declared = declaredType?.split(';')[0]?.trim().toLowerCase();
      if (
        declared !== undefined &&
        declared !== '' &&
        declared !== 'application/octet-stream' &&
        declared !== contentType
      ) {
        throw refuse(
          `The file says it is ${declared}, but its content is ${TYPE_NAMES[contentType]}.`,
        );
      }
      const extension = fileName.includes('.')
        ? fileName.split('.').at(-1)?.toLowerCase()
        : undefined;
      if (extension === undefined || !RECEIPT_EXTENSIONS[contentType].includes(extension)) {
        throw refuse(
          `The file name ends in ${extension === undefined ? 'no extension' : `.${extension}`}, but its content is ${TYPE_NAMES[contentType]}.`,
        );
      }

      const storageKey = newStorageKey();
      await storage.put(storageKey, content);
      try {
        const record = await repository.inReceiptWrite(transactionId, async (store) => {
          if ((await store.count(transactionId)) >= MAX_RECEIPTS_PER_TRANSACTION) {
            throw new AppError(
              409,
              'CONFLICT',
              `A transaction can have at most ${String(MAX_RECEIPTS_PER_TRANSACTION)} receipts.`,
            );
          }
          return store.create(caller.userId, {
            transactionId,
            storageKey,
            fileName,
            contentType,
            sizeBytes: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
            createdAt: now(),
          });
        });
        return toReceiptDto(record);
      } catch (error: unknown) {
        // The metadata was not saved: remove the stored file so nothing is left behind.
        await storage.remove(storageKey).catch((cleanupError: unknown) => {
          logger.warn(
            { errorCode: errorCode(cleanupError) },
            'An unreferenced receipt file could not be removed',
          );
        });
        throw error;
      }
    },

    download: async (caller, transactionId, receiptId) => {
      await transactionOf(caller, transactionId, false);
      const record = await repository.find(caller.userId, transactionId, receiptId);
      if (record === null) throw receiptNotFound();
      try {
        return { receipt: toReceiptDto(record), content: await storage.read(record.storageKey) };
      } catch (error: unknown) {
        if (error instanceof StoredFileMissingError) {
          logger.error({ receiptId: record.id }, 'A receipt file is missing from storage');
          throw new AppError(404, 'NOT_FOUND', 'This receipt file is no longer available.');
        }
        throw error;
      }
    },

    remove: async (caller, transactionId, receiptId) => {
      await transactionOf(caller, transactionId, true);
      await repository.inReceiptWrite(transactionId, async (store) => {
        const record = await store.find(caller.userId, transactionId, receiptId);
        if (record === null) throw receiptNotFound();
        await store.delete(record.id);
        // The file goes inside the database transaction: if it cannot be removed, the metadata
        // stays (rolled back) and the person is told nothing changed.
        try {
          await storage.remove(record.storageKey);
        } catch (error: unknown) {
          logger.error(
            { errorCode: errorCode(error), receiptId: record.id },
            'A receipt file could not be removed',
          );
          throw new AppError(
            503,
            'SERVICE_UNAVAILABLE',
            'The receipt could not be removed right now. Nothing was changed.',
          );
        }
      });
    },
  };
}
