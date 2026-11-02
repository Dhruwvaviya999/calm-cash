'use client';

import type {
  AssistantBlockDto,
  CurrencyCode,
  FigureDto,
  TransactionDraftResultDto,
} from '@calmcash/shared';
import { ArrowRight, Info, NotebookPen, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  FinancialAmount,
  directionForTransactionType,
} from '@/components/finance/financial-amount';
import { Button } from '@/components/ui/button';
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_PRESENTATION } from '@/lib/finance-presentation';
import { formatBasisPoints, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { assistantHref } from '../ai-presentation';

// The structured part of an assistant answer. Every figure here was computed by CalmCash's own
// services and arrives as exact minor units; the assistant's wording sits above it and never
// replaces it. Amounts are always shown with their currency, and currencies are never combined.

export interface ReferenceNames {
  accounts: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
}

export interface AssistantBlocksProps {
  blocks: readonly AssistantBlockDto[];
  timeZone: string;
  /** Account and category names for drafts (identifiers otherwise). */
  names?: ReferenceNames | undefined;
  /** Opens the ordinary entry form with a draft; absent where drafts cannot be reviewed. */
  onReviewDraft?:
    | ((result: Exclude<TransactionDraftResultDto, { kind: 'not_a_transaction' }>) => void)
    | undefined;
}

function describePeriod(period: { from: string; to: string }): string {
  return period.from === period.to
    ? formatDate(period.from, 'dayMonthYear')
    : `${formatDate(period.from, 'dayMonth')} – ${formatDate(period.to, 'dayMonthYear')}`;
}

function Figure({
  figure,
  currency,
}: {
  figure: FigureDto;
  currency: CurrencyCode | undefined;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{figure.label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        {figure.amountMinor !== undefined && currency !== undefined && (
          <FinancialAmount amountMinor={figure.amountMinor} currency={currency} size="sm" />
        )}
        {figure.text !== undefined && (
          <span className="text-xs text-muted-foreground">{figure.text}</span>
        )}
      </dd>
    </div>
  );
}

function DraftBlock({
  result,
  names,
  onReview,
}: {
  result: Exclude<TransactionDraftResultDto, { kind: 'not_a_transaction' }>;
  names: ReferenceNames | undefined;
  onReview: AssistantBlocksProps['onReviewDraft'];
}): ReactNode {
  const { draft, notes } = result;
  const name = (map: ReadonlyMap<string, string> | undefined, id: string | undefined): string =>
    id === undefined ? 'Not chosen yet' : (map?.get(id) ?? 'One of your accounts');
  const rows: [string, ReactNode][] = [
    ['Type', TRANSACTION_TYPE_PRESENTATION[draft.type].label],
    [
      'Amount',
      draft.amount === undefined
        ? 'Not clear yet'
        : `${draft.amount}${draft.currency === undefined ? '' : ` ${draft.currency}`}`,
    ],
    [draft.type === 'transfer' ? 'From' : 'Account', name(names?.accounts, draft.accountId)],
  ];
  if (draft.type === 'transfer') rows.push(['To', name(names?.accounts, draft.transferAccountId)]);
  if (draft.date !== undefined) rows.push(['Date', formatDate(draft.date, 'dayMonthYear')]);
  if (draft.merchant !== undefined)
    rows.push([draft.type === 'income' ? 'From' : 'Paid to', draft.merchant]);
  if (draft.description !== undefined) rows.push(['For', draft.description]);
  if (draft.type !== 'transfer') {
    rows.push([
      'Category',
      draft.categoryId === undefined
        ? 'Not chosen yet'
        : (names?.categories.get(draft.categoryId) ?? 'One of your categories'),
    ]);
  }
  if (draft.paymentMethod !== undefined)
    rows.push(['Paid with', PAYMENT_METHOD_LABELS[draft.paymentMethod]]);

  return (
    <section
      aria-label="Transaction draft"
      className="flex flex-col gap-3 rounded-xl border border-dashed border-primary/40 bg-accent/40 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <NotebookPen aria-hidden="true" className="size-4 text-primary" />
        Draft — not saved
      </p>
      {result.kind === 'clarification' && <p className="text-sm">{result.question}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
          {notes.map((note) => (
            <li key={`${note.field}:${note.message}`}>{note.message}</li>
          ))}
        </ul>
      )}
      {onReview !== undefined && (
        <div>
          <Button
            type="button"
            className="h-11 sm:h-9"
            onClick={() => {
              onReview(result);
            }}
          >
            Review and save
          </Button>
        </div>
      )}
    </section>
  );
}

function Block({
  block,
  timeZone,
  names,
  onReviewDraft,
}: {
  block: AssistantBlockDto;
  timeZone: string;
  names: ReferenceNames | undefined;
  onReviewDraft: AssistantBlocksProps['onReviewDraft'];
}): ReactNode {
  switch (block.kind) {
    case 'figures':
      return (
        <section aria-label={block.title} className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {block.title}
            <span className="font-normal text-muted-foreground">
              {block.period === undefined ? '' : ` · ${describePeriod(block.period)}`}
              {block.currency === undefined ? '' : ` · ${block.currency}`}
            </span>
          </p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {block.figures.map((figure) => (
              <Figure key={figure.label} figure={figure} currency={block.currency} />
            ))}
          </dl>
        </section>
      );
    case 'transactions':
      return (
        <section aria-label={block.title} className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {block.title}
            <span className="font-normal text-muted-foreground">
              {' '}
              · {block.totalCount === 1 ? '1 match' : `${block.totalCount.toString()} matches`}
              {block.totalCount > block.items.length
                ? `, ${block.items.length.toString()} shown`
                : ''}
            </span>
          </p>
          {block.items.length > 0 && (
            <ul className="flex flex-col divide-y rounded-lg border">
              {block.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={{ pathname: '/transactions', query: { transaction: item.id } }}
                    className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{item.merchant ?? item.description}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDate(item.occurredAt, 'dayMonthYear', timeZone)}
                        {item.category === undefined ? '' : ` · ${item.category}`}
                      </span>
                    </span>
                    <FinancialAmount
                      amountMinor={item.amountMinor}
                      currency={item.currency}
                      size="sm"
                      direction={
                        item.type === 'balance_adjustment'
                          ? 'balance'
                          : directionForTransactionType(item.type)
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    case 'categories':
      return (
        <section aria-label={block.title} className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {block.title}
            <span className="font-normal text-muted-foreground">
              {` · ${describePeriod(block.period)} · ${block.currency}`}
            </span>
          </p>
          <ul className="flex flex-col gap-2">
            {block.items.map((item) => (
              <li key={item.name} className="flex flex-col gap-1 text-sm">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatBasisPoints(item.shareBasisPoints)}
                    </span>
                    <FinancialAmount
                      amountMinor={item.amountMinor}
                      currency={block.currency}
                      size="sm"
                    />
                  </span>
                </span>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(BigInt(item.shareBasisPoints)) / 100)).toString()}%`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'links':
      return (
        <nav aria-label="Related pages" className="flex flex-wrap gap-2">
          {block.links.map((link) => (
            <Button key={link.label} asChild variant="outline" size="sm" className="h-11 sm:h-8">
              <Link href={assistantHref(link.target)}>
                {link.label}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ))}
        </nav>
      );
    case 'notice': {
      const Icon = block.tone === 'warning' ? TriangleAlert : Info;
      return (
        <p
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
            block.tone === 'warning'
              ? 'bg-warning/15 text-warning-text'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {block.text}
        </p>
      );
    }
    case 'transaction_draft':
      return block.result.kind === 'not_a_transaction' ? null : (
        <DraftBlock result={block.result} names={names} onReview={onReviewDraft} />
      );
  }
}

export function AssistantBlocks({
  blocks,
  timeZone,
  names,
  onReviewDraft,
}: AssistantBlocksProps): ReactNode {
  if (blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => (
        // Blocks are an ordered, immutable part of a stored answer, so their position is stable.
        <Block
          key={`${block.kind}-${index.toString()}`}
          block={block}
          timeZone={timeZone}
          names={names}
          onReviewDraft={onReviewDraft}
        />
      ))}
    </div>
  );
}
