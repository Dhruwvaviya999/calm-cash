import type { ReactNode } from 'react';

import { CategoryIcon } from '@/components/finance/category-icon';
import {
  directionForTransactionType,
  FinancialAmount,
} from '@/components/finance/financial-amount';
import { formatDate } from '@/lib/format';
import { ACCOUNT_TYPE_PRESENTATION, TRANSACTION_TYPE_LABELS } from '@/lib/finance-presentation';

import type { TransactionListItem } from '../types';

interface RowText {
  /** Who the money went to or came from. */
  title: string;
  /** What it was for. */
  purpose: string;
  categoryLabel: string;
}

function describe({ transaction, category, transferAccount }: TransactionListItem): RowText {
  if (transaction.type === 'transfer') {
    return {
      title: `To ${transferAccount?.name ?? 'another account'}`,
      purpose: transaction.description,
      categoryLabel: TRANSACTION_TYPE_LABELS.transfer,
    };
  }
  return {
    title: transaction.merchant ?? transaction.description,
    purpose:
      transaction.merchant === undefined ? (transaction.notes ?? '') : transaction.description,
    categoryLabel: category?.name ?? 'Uncategorised',
  };
}

/**
 * One transaction, laid out identically on mobile and desktop: who, why, when, how it was paid,
 * and how much. Direction is shown by sign, label, and colour together.
 */
export function TransactionRow({ item }: { item: TransactionListItem }): ReactNode {
  const { transaction, account, category } = item;
  const { title, purpose, categoryLabel } = describe(item);
  const AccountIcon = ACCOUNT_TYPE_PRESENTATION[account.type].icon;

  return (
    <div className="flex items-start gap-3 py-3.5">
      <CategoryIcon category={category} transactionType={transaction.type} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium">{title}</p>
          <FinancialAmount
            amountMinor={transaction.amountMinor}
            currency={transaction.currency}
            direction={directionForTransactionType(transaction.type)}
            className="shrink-0"
          />
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
          <p className="truncate">{purpose}</p>
          <time dateTime={transaction.occurredAt} className="shrink-0 tabular-nums">
            {formatDate(transaction.occurredAt)}
          </time>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{categoryLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <AccountIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{account.name}</span>
          </span>
        </p>
      </div>
    </div>
  );
}
