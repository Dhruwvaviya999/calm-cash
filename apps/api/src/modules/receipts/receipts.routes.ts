import {
  entityIdSchema,
  MAX_RECEIPT_BYTES,
  receiptUploadQuerySchema,
  type ReceiptDto,
  type ReceiptListDto,
} from '@calmcash/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import type { FileStorage } from '../../lib/file-storage';
import { sendSuccess } from '../../lib/http-response';
import type { Logger } from '../../lib/logger';
import {
  DEFAULT_UPLOAD_RATE,
  rawBody,
  uploadBodySchema,
  uploadRateLimit,
  type UploadRateRule,
} from '../../lib/upload';
import { validateRequest, type ValidatedRequestHandler } from '../../middleware/validate-request';
import type { ReceiptsRepository } from './receipts.repository';
import { createReceiptsService } from './receipts.service';

export interface ReceiptsModuleDependencies {
  repository: ReceiptsRepository;
  storage: FileStorage;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  uploadRate?: UploadRateRule;
}

const transactionParams = z.object({ transactionId: entityIdSchema });
const receiptParams = z.object({ transactionId: entityIdSchema, receiptId: entityIdSchema });

/** `Content-Disposition` with an ASCII fallback and the exact UTF-8 name (RFC 6266/5987). */
export function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Receipts of one transaction, mounted at `/transactions/:transactionId/receipts`. Every route
 * requires a session and checks that the transaction (and the receipt) belong to the caller; uploads
 * and removals also require the CSRF token. Files are only ever streamed through `…/file` — there
 * is no public URL — with `nosniff`, a sandboxing Content-Security-Policy, and `no-store`. PDFs are
 * always downloaded as attachments; images may be shown inline (`?disposition=inline`).
 *
 * GET    /                       receipts (metadata only)
 * POST   /?fileName=             upload one receipt as the raw body (≤ 4 MB)
 * GET    /:receiptId/file        the file
 * DELETE /:receiptId             remove the receipt (the transaction is untouched)
 */
export function createReceiptsRouter(
  dependencies: ReceiptsModuleDependencies,
  logger: Logger,
  auth: AuthBoundary,
): Router {
  const service = createReceiptsService({
    repository: dependencies.repository,
    storage: dependencies.storage,
    logger,
    now: dependencies.now ?? ((): Date => new Date()),
  });
  const caller = auth.getCaller;
  const router = Router({ mergeParams: true });

  const list: Handler<{ params: { transactionId: string } }, ReceiptListDto> = async (
    { params },
    req,
    res,
  ) => {
    sendSuccess(res, await service.list(caller(req), params.transactionId));
  };
  const upload: Handler<
    { params: { transactionId: string }; query: { fileName: string }; body: Buffer },
    ReceiptDto
  > = async ({ params, query, body }, req, res) => {
    const receipt = await service.upload(caller(req), params.transactionId, {
      fileName: query.fileName,
      declaredType: req.get('content-type'),
      content: body,
    });
    sendSuccess(res, receipt, 201);
  };
  const download: ValidatedRequestHandler<
    {
      params: { transactionId: string; receiptId: string };
      query: { disposition: 'attachment' | 'inline' };
    },
    unknown
  > = async ({ params, query }, req, res: Response) => {
    const { receipt, content } = await service.download(
      caller(req),
      params.transactionId,
      params.receiptId,
    );
    const inline = query.disposition === 'inline' && receipt.contentType.startsWith('image/');
    res.setHeader('Content-Type', receipt.contentType);
    res.setHeader('Content-Length', String(content.length));
    res.setHeader(
      'Content-Disposition',
      contentDisposition(inline ? 'inline' : 'attachment', receipt.fileName),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).end(content);
  };
  const remove: Handler<
    { params: { transactionId: string; receiptId: string } },
    { removed: true }
  > = async ({ params }, req, res) => {
    await service.remove(caller(req), params.transactionId, params.receiptId);
    sendSuccess(res, { removed: true });
  };

  router.use(auth.requireSession, auth.requireCsrf, noStore);
  router.get('/', validateRequest(z.object({ params: transactionParams }), list));
  router.post(
    '/',
    uploadRateLimit(dependencies.uploadRate ?? DEFAULT_UPLOAD_RATE, (req) => caller(req).userId),
    rawBody(MAX_RECEIPT_BYTES),
    validateRequest(
      z.object({
        params: transactionParams,
        query: receiptUploadQuerySchema,
        body: uploadBodySchema,
      }),
      upload,
    ),
  );
  router.get(
    '/:receiptId/file',
    validateRequest(
      z.object({
        params: receiptParams,
        query: z.strictObject({
          disposition: z.enum(['attachment', 'inline']).default('attachment'),
        }),
      }),
      download,
    ),
  );
  router.delete('/:receiptId', validateRequest(z.object({ params: receiptParams }), remove));

  return router;
}
