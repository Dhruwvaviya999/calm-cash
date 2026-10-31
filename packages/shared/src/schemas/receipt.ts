import { z } from 'zod';

import { MAX_RECEIPT_FILE_NAME_LENGTH, RECEIPT_CONTENT_TYPES } from '../constants/imports';
import type { ReceiptDto, ReceiptListDto, ReceiptUploadQuery } from '../types/receipt';
import { entityIdSchema, isoDateTimeSchema } from './common';
import { safeFileNameSchema } from './import';

export const receiptContentTypeSchema = z.enum(RECEIPT_CONTENT_TYPES);

export const receiptUploadQuerySchema = z.strictObject({
  fileName: safeFileNameSchema(MAX_RECEIPT_FILE_NAME_LENGTH),
}) satisfies z.ZodType<ReceiptUploadQuery>;

export const receiptDtoSchema = z.object({
  id: entityIdSchema,
  transactionId: entityIdSchema,
  fileName: z.string().min(1).max(MAX_RECEIPT_FILE_NAME_LENGTH),
  contentType: receiptContentTypeSchema,
  // Existing receipt metadata remains readable when the upload limit is lowered.
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: isoDateTimeSchema,
}) satisfies z.ZodType<ReceiptDto>;

export const receiptListDtoSchema = z.object({
  receipts: z.array(receiptDtoSchema),
}) satisfies z.ZodType<ReceiptListDto>;
