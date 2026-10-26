import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { CategoryIcon } from '@/components/finance/category-icon';
import { directionForTransaction, FinancialAmount } from '@/components/finance/financial-amount';
import { formatDate } from '@/lib/format';
import { ACCOUNT_TYPE_PRESENTATION, TRANSACTION_TYPE_LABELS } from '@/lib/finance-presentation';
import { cn } from '@/lib/utils';

import { categoryLabel } from '../transaction-presentation';
import type { TransactionListItem } from '../types';

interface RowText {
  /** Who the money went to or came from. */
  title: string;
  /** What it was for. */
  purpose: string;
  categoryLabel: string;
}

function describe({ transaction, category, transferAccount }: TransactionListItem): RowText {
  switch (transaction.type) {
    case 'transfer':
      return {
        title: `To ${transferAccount?.name ?? 'another account'}`,
        purpose: transaction.description,
        categoryLabel: TRANSACTION_TYPE_LABELS.transfer,
      };
    case 'balance_adjustment':
      return {
        title: TRANSACTION_TYPE_LABELS.balance_adjustment,
        purpose: transaction.description,
        categoryLabel: TRANSACTION_TYPE_LABELS.balance_adjustment,
      };
    case 'income':
    case 'expense':
      return {
        title: transaction.merchant ?? transaction.description,
        purpose:
          transaction.merchant === undefined ? (transaction.notes ?? '') : transaction.description,
        categoryLabel: categoryLabel(category),
      };
  }
}

/**
 * One transaction, laid out identically on mobile and desktop: who, why, when, how it was paid,
 * and how much. Direction is shown by sign, label, and colour together.
 */
export function TransactionRow({
  item,
  timeZone,
}: {
  item: TransactionListItem;
  /** The signed-in user's time zone; the design preview uses the default display zone. */
  timeZone?: string;
}): ReactNode {
  const { transaction, account, category } = item;
  const text = describe(item);
  const AccountIcon = ACCOUNT_TYPE_PRESENTATION[account.type].icon;
  const voided = transaction.status === 'voided';

  return (
    <div className={cn('flex items-start gap-3 py-3.5', voided && 'opacity-70')}>
      <CategoryIcon category={category} transactionType={transaction.type} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium">{text.title}</p>
          <FinancialAmount
            amountMinor={transaction.amountMinor}
            currency={transaction.currency}
            direction={directionForTransaction(transaction)}
            className={cn('shrink-0', voided && 'line-through')}
          />
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
          <p className="truncate">{text.purpose}</p>
          <time dateTime={transaction.occurredAt} className="shrink-0 tabular-nums">
            {formatDate(transaction.occurredAt, 'dayMonth', timeZone)}
          </time>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{text.categoryLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <AccountIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{account.name}</span>
          </span>
          {voided && (
            <StatusBadge tone="neutral" className="ml-auto">
              Voided
            </StatusBadge>
          )}
        </p>
      </div>
    </div>
  );
}
