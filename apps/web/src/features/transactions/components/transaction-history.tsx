'use client';

import type { PaginationDto, TransactionListItemDto } from '@calmcash/shared';
import { Ban, ChevronLeft, ChevronRight, Ellipsis, Eye, Pencil, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { CategoryIcon } from '@/components/finance/category-icon';
import { directionForTransaction, FinancialAmount } from '@/components/finance/financial-amount';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_LABELS } from '@/lib/finance-presentation';
import { cn } from '@/lib/utils';

import { categoryLabel, counterpartyTitle } from '../transaction-presentation';
import { TransactionRow } from './transaction-row';

export interface TransactionHistoryProps {
  items: readonly TransactionListItemDto[];
  pagination: PaginationDto;
  timeZone: string;
  /** Present while selecting for a bulk action. */
  selection: ReadonlySet<string> | undefined;
  onToggleSelected: (item: TransactionListItemDto) => void;
  onToggleAll: (items: readonly TransactionListItemDto[]) => void;
  onOpen: (item: TransactionListItemDto) => void;
  onEdit: (item: TransactionListItemDto) => void;
  onVoid: (item: TransactionListItemDto) => void;
  onRestore: (item: TransactionListItemDto) => void;
  onPage: (page: number) => void;
}

function editable(item: TransactionListItemDto): boolean {
  return item.account.status === 'active' && item.transferAccount?.status !== 'archived';
}

function purpose(item: TransactionListItemDto): string {
  const { transaction } = item;
  // Without a merchant, the description is already the title; show the notes underneath.
  if (
    (transaction.type === 'income' || transaction.type === 'expense') &&
    transaction.merchant === undefined
  ) {
    return transaction.notes ?? '';
  }
  return transaction.description;
}

function RowActions({
  item,
  onOpen,
  onEdit,
  onVoid,
  onRestore,
}: Pick<TransactionHistoryProps, 'onOpen' | 'onEdit' | 'onVoid' | 'onRestore'> & {
  item: TransactionListItemDto;
}): ReactNode {
  const voided = item.transaction.status === 'voided';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${counterpartyTitle(item)}`}
          className="size-10 rounded-full"
        >
          <Ellipsis aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={() => {
            onOpen(item);
          }}
        >
          <Eye aria-hidden="true" />
          View details
        </DropdownMenuItem>
        {editable(item) &&
          (voided ? (
            <DropdownMenuItem
              onSelect={() => {
                onRestore(item);
              }}
            >
              <Undo2 aria-hidden="true" />
              Restore
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  onEdit(item);
                }}
              >
                <Pencil aria-hidden="true" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  onVoid(item);
                }}
              >
                <Ban aria-hidden="true" />
                Void
              </DropdownMenuItem>
            </>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectBox({
  item,
  selected,
  onToggle,
}: {
  item: TransactionListItemDto;
  selected: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      aria-label={`Select ${counterpartyTitle(item)}`}
      className="size-5 shrink-0 cursor-pointer accent-primary"
    />
  );
}

/**
 * The transaction history: a table on wide screens, compact rows on phones (never a desktop table
 * squeezed onto a phone), and pagination. Both layouts show who, why, when, the account, and the
 * amount with its sign; secondary details live in the details sheet.
 */
export function TransactionHistory(props: TransactionHistoryProps): ReactNode {
  const { items, pagination, timeZone, selection, onToggleSelected, onToggleAll, onOpen, onPage } =
    props;
  const allSelected =
    selection !== undefined && items.every((item) => selection.has(item.transaction.id));
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = first + items.length - 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Phones, tablets, and narrow laptops (the table needs room beside the sidebar) */}
      <ul
        aria-label="Transactions"
        className="divide-y rounded-2xl border bg-card px-4 shadow-sm xl:hidden"
      >
        {items.map((item) => {
          const selected = selection?.has(item.transaction.id) ?? false;
          return (
            <li key={item.transaction.id} className="relative flex items-center gap-3">
              {selection !== undefined && (
                <SelectBox
                  item={item}
                  selected={selected}
                  onToggle={() => {
                    onToggleSelected(item);
                  }}
                />
              )}
              <div className="min-w-0 flex-1">
                <TransactionRow item={item} timeZone={timeZone} />
              </div>
              {selection === undefined && (
                <button
                  type="button"
                  aria-label={`Details of ${counterpartyTitle(item)}`}
                  onClick={() => {
                    onOpen(item);
                  }}
                  className="absolute inset-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                />
              )}
            </li>
          );
        })}
      </ul>

      {/* Wide desktops */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm xl:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">
            Transactions {first}–{last} of {pagination.totalItems}
          </caption>
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {selection !== undefined && (
                <th scope="col" className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => {
                      onToggleAll(items);
                    }}
                    aria-label="Select all on this page"
                    className="size-4 cursor-pointer accent-primary"
                  />
                </th>
              )}
              <th scope="col" className="w-24 px-4 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Who and why
              </th>
              <th scope="col" className="w-44 px-4 py-3 font-medium">
                Category
              </th>
              <th scope="col" className="w-48 px-4 py-3 font-medium">
                Account
              </th>
              <th scope="col" className="w-32 px-4 py-3 font-medium">
                Method
              </th>
              <th scope="col" className="w-36 px-4 py-3 text-right font-medium">
                Amount
              </th>
              <th scope="col" className="w-16 px-2 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => {
              const { transaction, account, transferAccount, category } = item;
              const voided = transaction.status === 'voided';
              const method =
                transaction.type === 'balance_adjustment' ? undefined : transaction.paymentMethod;
              return (
                <tr
                  key={transaction.id}
                  className={cn('align-top hover:bg-muted/30', voided && 'text-muted-foreground')}
                >
                  {selection !== undefined && (
                    <td className="px-4 py-3.5">
                      <SelectBox
                        item={item}
                        selected={selection.has(transaction.id)}
                        onToggle={() => {
                          onToggleSelected(item);
                        }}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3.5 whitespace-nowrap tabular-nums">
                    <time dateTime={transaction.occurredAt}>
                      {formatDate(transaction.occurredAt, 'dayMonthYear', timeZone)}
                    </time>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex min-w-0 items-start gap-3">
                      <CategoryIcon
                        category={category}
                        transactionType={transaction.type}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            onOpen(item);
                          }}
                          className="block max-w-full truncate rounded-sm text-left font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {counterpartyTitle(item)}
                        </button>
                        <p className="truncate text-muted-foreground">{purpose(item)}</p>
                        {voided && (
                          <StatusBadge tone="neutral" className="mt-1">
                            Voided
                          </StatusBadge>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="truncate px-4 py-3.5">
                    {transaction.type === 'income' || transaction.type === 'expense'
                      ? categoryLabel(category)
                      : TRANSACTION_TYPE_LABELS[transaction.type]}
                  </td>
                  <td className="truncate px-4 py-3.5">
                    {transferAccount === undefined
                      ? account.name
                      : `${account.name} → ${transferAccount.name}`}
                  </td>
                  <td className="truncate px-4 py-3.5">
                    {method === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      PAYMENT_METHOD_LABELS[method]
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <FinancialAmount
                      amountMinor={transaction.amountMinor}
                      currency={transaction.currency}
                      direction={directionForTransaction(transaction)}
                      {...(voided ? { className: 'line-through' } : {})}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <RowActions item={item} {...props} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Showing {first}–{last} of {pagination.totalItems}
        </p>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-10"
              disabled={pagination.page <= 1}
              onClick={() => {
                onPage(pagination.page - 1);
              }}
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <span className="text-sm tabular-nums">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              className="h-10"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => {
                onPage(pagination.page + 1);
              }}
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </nav>
    </div>
  );
}
