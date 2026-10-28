'use client';

import type { TransactionListItemDto } from '@calmcash/shared';
import { Ban, Pencil, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { CategoryIcon } from '@/components/finance/category-icon';
import { directionForTransaction, FinancialAmount } from '@/components/finance/financial-amount';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ReceiptsPanel } from '@/features/receipts';
import { formatDateTime } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_PRESENTATION } from '@/lib/finance-presentation';

import { categoryLabel, counterpartyTitle } from '../transaction-presentation';

export interface TransactionDetailsSheetProps {
  item: TransactionListItemDto | undefined;
  timeZone: string;
  onClose: () => void;
  onEdit: (item: TransactionListItemDto) => void;
  onVoid: (item: TransactionListItemDto) => void;
  onRestore: (item: TransactionListItemDto) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** Everything recorded about one transaction, with edit, void, restore, and its receipts. */
export function TransactionDetailsSheet({
  item,
  timeZone,
  onClose,
  onEdit,
  onVoid,
  onRestore,
}: TransactionDetailsSheetProps): ReactNode {
  return (
    <Sheet
      open={item !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {item !== undefined && (
          <Details item={item} timeZone={timeZone} {...{ onEdit, onVoid, onRestore }} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({
  item,
  timeZone,
  onEdit,
  onVoid,
  onRestore,
}: Omit<TransactionDetailsSheetProps, 'item' | 'onClose'> & {
  item: TransactionListItemDto;
}): ReactNode {
  const { transaction, account, transferAccount, category } = item;
  const voided = transaction.status === 'voided';
  const archived = account.status === 'archived' || transferAccount?.status === 'archived';
  const counterparty =
    transaction.type === 'income' || transaction.type === 'expense'
      ? transaction.merchant
      : undefined;
  const paymentMethod =
    transaction.type === 'balance_adjustment' ? undefined : transaction.paymentMethod;

  return (
    <>
      <SheetHeader className="gap-3 border-b px-5 pt-5 pr-14 pb-4">
        <div className="flex items-center gap-3">
          <CategoryIcon category={category} transactionType={transaction.type} />
          <div className="min-w-0">
            <SheetTitle className="truncate text-lg">{counterpartyTitle(item)}</SheetTitle>
            <SheetDescription>
              {TRANSACTION_TYPE_PRESENTATION[transaction.type].label}
            </SheetDescription>
          </div>
        </div>
        {voided && (
          <StatusBadge tone="neutral" className="self-start">
            Voided
          </StatusBadge>
        )}
      </SheetHeader>

      <div className="flex flex-col gap-6 px-5 py-5">
        <FinancialAmount
          amountMinor={transaction.amountMinor}
          currency={transaction.currency}
          direction={directionForTransaction(transaction)}
          size="display"
          {...(voided ? { className: 'line-through' } : {})}
        />

        <dl className="divide-y border-y">
          <Row label={transaction.type === 'balance_adjustment' ? 'Reason' : 'Purpose'}>
            {transaction.description}
          </Row>
          {counterparty !== undefined && (
            <Row label={transaction.type === 'expense' ? 'Paid to' : 'Received from'}>
              {counterparty}
            </Row>
          )}
          {(transaction.type === 'income' || transaction.type === 'expense') && (
            <Row label="Category">{categoryLabel(category)}</Row>
          )}
          <Row label={transaction.type === 'transfer' ? 'From' : 'Account'}>
            {account.name}
            {account.status === 'archived' && ' (archived)'}
          </Row>
          {transferAccount !== undefined && (
            <Row label="To">
              {transferAccount.name}
              {transferAccount.status === 'archived' && ' (archived)'}
            </Row>
          )}
          {transaction.type === 'balance_adjustment' && (
            <Row label="Direction">
              {transaction.adjustmentDirection === 'increase' ? 'Balance up' : 'Balance down'}
            </Row>
          )}
          <Row label="When">{formatDateTime(transaction.occurredAt, timeZone)}</Row>
          {paymentMethod !== undefined && (
            <Row label="Payment method">{PAYMENT_METHOD_LABELS[paymentMethod]}</Row>
          )}
          {transaction.tags.length > 0 && <Row label="Tags">{transaction.tags.join(', ')}</Row>}
          {transaction.notes !== undefined && (
            <Row label="Notes">
              <span className="whitespace-pre-line">{transaction.notes}</span>
            </Row>
          )}
          {transaction.voidedAt !== undefined && (
            <Row label="Voided">
              {formatDateTime(transaction.voidedAt, timeZone)}
              {transaction.voidReason !== undefined && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {transaction.voidReason}
                </span>
              )}
            </Row>
          )}
          <Row label="Recorded">{formatDateTime(transaction.createdAt, timeZone)}</Row>
        </dl>

        {archived ? (
          <FormMessage tone="info">
            This transaction uses an archived account, so it is read-only. Restore the account to
            change it.
          </FormMessage>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {voided ? (
              <Button
                className="h-11 sm:h-9"
                onClick={() => {
                  onRestore(item);
                }}
              >
                <Undo2 aria-hidden="true" />
                Restore transaction
              </Button>
            ) : (
              <>
                <Button
                  className="h-11 sm:h-9"
                  onClick={() => {
                    onEdit(item);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className="h-11 sm:h-9"
                  onClick={() => {
                    onVoid(item);
                  }}
                >
                  <Ban aria-hidden="true" />
                  Void
                </Button>
              </>
            )}
          </div>
        )}

        <ReceiptsPanel
          key={transaction.id}
          transactionId={transaction.id}
          timeZone={timeZone}
          readOnly={archived}
        />
      </div>
    </>
  );
}
