import {
  receiptDtoSchema,
  receiptListDtoSchema,
  type EntityId,
  type ReceiptDto,
  type ReceiptListDto,
} from '@calmcash/shared';
import { z } from 'zod';

import { api } from '@/lib/api';

// Receipts of one transaction. Files are only fetched through the authorised API (never a public
// URL); the content type is decided by the API from the file's content.

function receiptsPath(transactionId: EntityId): `/${string}` {
  return `/transactions/${encodeURIComponent(transactionId)}/receipts`;
}

export function listReceipts(
  transactionId: EntityId,
  signal?: AbortSignal,
): Promise<ReceiptListDto> {
  return api.request(receiptsPath(transactionId), { schema: receiptListDtoSchema, signal });
}

export function uploadReceipt(transactionId: EntityId, file: File): Promise<ReceiptDto> {
  const query = new URLSearchParams({ fileName: file.name });
  return api.request(`${receiptsPath(transactionId)}?${query.toString()}`, {
    schema: receiptDtoSchema,
    method: 'POST',
    file,
  });
}

/** The file itself, for a preview (images) or to save. */
export function downloadReceipt(
  transactionId: EntityId,
  receiptId: EntityId,
  signal?: AbortSignal,
): Promise<Blob> {
  return api.download(
    `${receiptsPath(transactionId)}/${encodeURIComponent(receiptId)}/file`,
    signal,
  );
}

export function removeReceipt(transactionId: EntityId, receiptId: EntityId): Promise<void> {
  return api
    .request(`${receiptsPath(transactionId)}/${encodeURIComponent(receiptId)}`, {
      schema: z.object({ removed: z.literal(true) }),
      method: 'DELETE',
    })
    .then(() => undefined);
}
