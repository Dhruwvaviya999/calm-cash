import type { ReceiptContentType } from '../constants/imports';
import type { EntityId, IsoDateTimeString } from './common';

/** A receipt attached to a transaction. Files are only ever served through authorised requests. */
export interface ReceiptDto {
  id: EntityId;
  transactionId: EntityId;
  fileName: string;
  /** Determined from the file's content, not from its name. */
  contentType: ReceiptContentType;
  sizeBytes: number;
  /** Hex SHA-256 of the content. */
  sha256: string;
  createdAt: IsoDateTimeString;
}

export interface ReceiptListDto {
  receipts: ReceiptDto[];
}

/** Query of the upload request; the file itself is the raw request body. */
export interface ReceiptUploadQuery {
  fileName: string;
}
