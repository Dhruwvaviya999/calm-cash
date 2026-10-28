'use client';

import type { ImportBatchDetailDto } from '@calmcash/shared';
import { ExternalLink, ListChecks } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';

import { describeDifference } from '../import-presentation';

/** A finished (completed or cancelled) import: what it did, and what was checked. */
export function ImportSummary({
  batch,
  timeZone,
}: {
  batch: ImportBatchDetailDto;
  timeZone: string;
}): ReactNode {
  const { counts, reconciliation } = batch;
  const leftOut = counts.ready + counts.review + counts.failed + counts.invalid;
  const finishedAt = batch.completedAt ?? batch.cancelledAt;
  const tiles = [
    { label: 'Imported', value: counts.imported },
    { label: 'Matched to existing', value: counts.matched },
    { label: 'Skipped', value: counts.skipped },
    { label: 'Left out', value: leftOut },
  ];

  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-5">
      <SectionHeader
        id="summary-heading"
        title={batch.status === 'completed' ? 'Import finished' : 'Import cancelled'}
        {...(finishedAt === undefined
          ? {}
          : { description: `On ${formatDateTime(finishedAt, timeZone)}.` })}
      />
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border bg-card px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{tile.value}</dd>
          </div>
        ))}
      </dl>

      {reconciliation?.differenceMinor === undefined ? (
        <FormMessage tone="info">
          The statement&apos;s closing balance was not compared with the ledger.
        </FormMessage>
      ) : (
        <FormMessage tone={reconciliation.differenceMinor === '0' ? 'success' : 'info'}>
          When it was last checked ({formatDateTime(reconciliation.checkedAt, timeZone)}), the
          closing balance was compared with the ledger.{' '}
          {describeDifference(reconciliation.differenceMinor, batch.currency, batch.account.type)}
        </FormMessage>
      )}
      {reconciliation?.adjustmentTransactionId !== undefined && (
        <p className="text-sm">
          <Link
            href={`/transactions?transaction=${reconciliation.adjustmentTransactionId}`}
            className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
          >
            Open the balance correction
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Imported transactions are ordinary transactions: edit or void them on the Transactions page.
        The statement&apos;s raw text was discarded; each row&apos;s details remain.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild size="lg" className="h-11">
          <Link href={`/transactions?accountId=${batch.account.id}`}>See {batch.account.name}</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-11">
          <Link href={`/imports?batch=${batch.id}&step=review`}>
            <ListChecks aria-hidden="true" />
            See every row
          </Link>
        </Button>
      </div>
    </section>
  );
}
