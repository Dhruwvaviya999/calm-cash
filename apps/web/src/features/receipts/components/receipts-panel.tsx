'use client';

import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_TRANSACTION,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_EXTENSIONS,
  type ReceiptContentType,
  type ReceiptDto,
} from '@calmcash/shared';
import { Download, Eye, EyeOff, FileImage, FileText, Paperclip, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatBytes, formatDate } from '@/lib/format';
import { describeRequestError, describeRequestProblems } from '@/lib/form-errors';
import {
  downloadReceipt,
  listReceipts,
  removeReceipt,
  uploadReceipt,
} from '@/services/receipts.service';

const TYPE_LABELS: Readonly<Record<ReceiptContentType, string>> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

/** What the file picker offers; the API still checks every file's content. */
const ACCEPT = [
  ...RECEIPT_CONTENT_TYPES,
  ...Object.values(RECEIPT_EXTENSIONS)
    .flat()
    .map((extension) => `.${extension}`),
].join(',');

type Notice = { tone: 'success' | 'error'; message: string } | undefined;

export interface ReceiptsPanelProps {
  transactionId: string;
  timeZone: string;
  /** Receipts of transactions on archived accounts can be viewed but not changed. */
  readOnly: boolean;
}

/** Saves a fetched file under its original name through a temporary object URL. */
function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked after the click has been handled, so the download can start.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Receipts attached to one transaction: attach (JPEG, PNG, WebP, or PDF up to 10 MB), preview
 * images, save any file, and remove. Files are fetched only through the authorised API; receipts
 * never change the transaction or any balance.
 */
export function ReceiptsPanel({
  transactionId,
  timeZone,
  readOnly,
}: ReceiptsPanelProps): ReactNode {
  const receipts = useAsyncResource(
    useCallback(
      async (signal: AbortSignal) => (await listReceipts(transactionId, signal)).receipts,
      [transactionId],
    ),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [removing, setRemoving] = useState<ReceiptDto | undefined>();

  const list = receipts.state.status === 'success' ? receipts.state.data : [];
  const full = list.length >= MAX_RECEIPTS_PER_TRANSACTION;

  const attach = async (file: File): Promise<void> => {
    setNotice(undefined);
    if (file.size === 0) {
      setNotice({ tone: 'error', message: `${file.name} is empty.` });
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setNotice({
        tone: 'error',
        message: `${file.name} is ${formatBytes(file.size)}. Receipts can be at most 10 MB.`,
      });
      return;
    }
    setUploading(true);
    try {
      const receipt = await uploadReceipt(transactionId, file);
      setNotice({ tone: 'success', message: `${receipt.fileName} was attached.` });
      receipts.refresh();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestProblems(error) });
    } finally {
      setUploading(false);
    }
  };

  const remove = async (receipt: ReceiptDto): Promise<void> => {
    setNotice(undefined);
    try {
      await removeReceipt(transactionId, receipt.id);
      setNotice({ tone: 'success', message: `${receipt.fileName} was removed.` });
      receipts.refresh();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  let content: ReactNode;
  if (receipts.state.status === 'loading') {
    content = (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading receipts…</span>
        <ListSkeleton rows={2} />
      </div>
    );
  } else if (receipts.state.status === 'error') {
    content = (
      <FormMessage tone="error">
        Receipts could not be loaded. {describeRequestError(receipts.state.error)}{' '}
        <Button variant="link" className="h-auto p-0" onClick={receipts.reload}>
          Try again
        </Button>
      </FormMessage>
    );
  } else if (list.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        {readOnly ? 'No receipts are attached.' : 'No receipts yet.'}
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col divide-y rounded-xl border">
        {list.map((receipt) => (
          <ReceiptItem
            key={receipt.id}
            receipt={receipt}
            transactionId={transactionId}
            timeZone={timeZone}
            readOnly={readOnly}
            onError={(message) => {
              setNotice({ tone: 'error', message });
            }}
            onRemove={() => {
              setRemoving(receipt);
            }}
          />
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="receipts-heading" className="flex flex-col gap-3">
      <SectionHeader
        id="receipts-heading"
        title="Receipts"
        description={
          readOnly
            ? 'Read-only while the account is archived.'
            : 'JPEG, PNG, WebP, or PDF, up to 10 MB each.'
        }
        action={
          readOnly ? undefined : (
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={uploading || full || receipts.state.status !== 'success'}
              aria-busy={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" />
              {uploading ? 'Attaching…' : 'Attach'}
            </Button>
          )
        }
      />
      {!readOnly && (
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          aria-label="Receipt file"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same file again (after a failure) still triggers a change.
            event.target.value = '';
            if (file !== undefined) {
              void attach(file);
            }
          }}
        />
      )}
      {full && !readOnly && (
        <p className="text-sm text-muted-foreground">
          This transaction has the most receipts it can hold ({String(MAX_RECEIPTS_PER_TRANSACTION)}
          ). Remove one to attach another.
        </p>
      )}
      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
      {content}

      <ConfirmDialog
        open={removing !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(undefined);
          }
        }}
        title="Remove this receipt?"
        description={`${removing?.fileName ?? 'The receipt'} will be deleted. The transaction itself does not change.`}
        confirmLabel="Remove receipt"
        destructive
        onConfirm={() => {
          const target = removing;
          setRemoving(undefined);
          if (target !== undefined) {
            void remove(target);
          }
        }}
      />
    </section>
  );
}

interface ReceiptItemProps {
  receipt: ReceiptDto;
  transactionId: string;
  timeZone: string;
  readOnly: boolean;
  onError: (message: string) => void;
  onRemove: () => void;
}

function ReceiptItem({
  receipt,
  transactionId,
  timeZone,
  readOnly,
  onError,
  onRemove,
}: ReceiptItemProps): ReactNode {
  const image = receipt.contentType !== 'application/pdf';
  const [preview, setPreview] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const Icon = image ? FileImage : FileText;

  // The object URL lives only while the preview is shown.
  useEffect(
    () => () => {
      if (preview !== undefined) {
        URL.revokeObjectURL(preview);
      }
    },
    [preview],
  );

  const fetchFile = async (): Promise<Blob | undefined> => {
    setBusy(true);
    try {
      return await downloadReceipt(transactionId, receipt.id);
    } catch (error: unknown) {
      onError(`${receipt.fileName} could not be opened. ${describeRequestError(error)}`);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 px-3 py-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium break-all">{receipt.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {TYPE_LABELS[receipt.contentType]} · {formatBytes(receipt.sizeBytes)} · Added{' '}
            {formatDate(receipt.createdAt, 'dayMonthYear', timeZone)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-12">
        {image && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            disabled={busy}
            aria-expanded={preview !== undefined}
            aria-label={`${preview === undefined ? 'Preview' : 'Hide preview of'} ${receipt.fileName}`}
            onClick={() => {
              if (preview !== undefined) {
                setPreview(undefined);
                return;
              }
              void fetchFile().then((blob) => {
                if (blob !== undefined) {
                  setPreview(URL.createObjectURL(blob));
                }
              });
            }}
          >
            {preview === undefined ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            {preview === undefined ? 'Preview' : 'Hide'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-11 sm:h-8"
          disabled={busy}
          aria-label={`Save ${receipt.fileName}`}
          onClick={() => {
            void fetchFile().then((blob) => {
              if (blob !== undefined) {
                saveFile(blob, receipt.fileName);
              }
            });
          }}
        >
          <Download aria-hidden="true" />
          Save
        </Button>
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 text-expense hover:text-expense sm:h-8"
            aria-label={`Remove ${receipt.fileName}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        )}
      </div>
      {preview !== undefined && (
        // Object URLs are not optimisable by next/image; this is a private, already-loaded file.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={`Receipt ${receipt.fileName}`}
          className="max-h-96 w-full rounded-lg border bg-muted object-contain"
        />
      )}
    </li>
  );
}
