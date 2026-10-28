'use client';

import type { ImportBatchDto } from '@calmcash/shared';
import { ChevronRight, FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { StatusBadge } from '@/components/feedback/status-badge';
import { SectionHeader } from '@/components/layout/page-header';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDateTime } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { listImports } from '@/services/imports.service';

import {
  BATCH_STATUS_PRESENTATION,
  describeOutcomes,
  describePeriod,
} from '../import-presentation';

/** Earlier imports, newest first; open ones can be resumed from here. */
export function ImportHistory(): ReactNode {
  const { user } = useSignedInSession();
  const history = useAsyncResource(listImports);

  let content: ReactNode;
  if (history.state.status === 'loading') {
    content = (
      <div role="status" aria-live="polite" className="rounded-2xl border bg-card px-4 py-2">
        <span className="sr-only">Loading your imports…</span>
        <ListSkeleton rows={3} />
      </div>
    );
  } else if (history.state.status === 'error') {
    content = (
      <ErrorState
        title="Your imports could not be loaded"
        description={describeRequestError(history.state.error)}
        onRetry={history.reload}
      />
    );
  } else if (history.state.data.batches.length === 0) {
    content = (
      <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Imports you start appear here, so you can come back to one later.
      </p>
    );
  } else {
    content = (
      <ul aria-label="Statement imports" className="divide-y rounded-2xl border bg-card shadow-sm">
        {history.state.data.batches.map((batch) => (
          <HistoryItem key={batch.id} batch={batch} timeZone={user.timezone} />
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="import-history-heading" className="flex flex-col gap-3">
      <SectionHeader id="import-history-heading" title="Earlier imports" />
      {content}
    </section>
  );
}

function HistoryItem({ batch, timeZone }: { batch: ImportBatchDto; timeZone: string }): ReactNode {
  const status = BATCH_STATUS_PRESENTATION[batch.status];
  const period = describePeriod(batch);
  const open = batch.status === 'mapping' || batch.status === 'reviewing';
  return (
    <li>
      <Link
        href={`/imports?batch=${batch.id}`}
        className="flex items-center gap-3 rounded-2xl px-4 py-3.5 outline-none hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
          <FileSpreadsheet aria-hidden="true" className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium break-all">{batch.fileName}</span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
          <span className="text-sm text-muted-foreground">
            {batch.account.name}
            {period === undefined ? '' : ` · ${period}`}
          </span>
          <span className="text-xs text-muted-foreground">
            {describeOutcomes(batch)} of {batch.totalRows} rows · Uploaded{' '}
            {formatDateTime(batch.createdAt, timeZone)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          <span className="max-sm:sr-only">{open ? 'Continue' : 'View'}</span>
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </Link>
    </li>
  );
}
