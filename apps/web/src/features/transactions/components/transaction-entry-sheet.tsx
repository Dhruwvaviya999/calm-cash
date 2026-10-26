'use client';

import type {
  AccountWithBalanceDto,
  CategoryDto,
  CurrencyCode,
  TransactionListItemDto,
} from '@calmcash/shared';
import type { ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { ReconcileForm } from './reconcile-form';
import { TransactionForm, type TransactionFormMode } from './transaction-form';

export type EntrySheetMode =
  TransactionFormMode | { kind: 'reconcile'; accountId?: string | undefined };

export interface TransactionEntrySheetProps {
  /** `undefined` closes the sheet. */
  mode: EntrySheetMode | undefined;
  accounts: readonly AccountWithBalanceDto[];
  categories: readonly CategoryDto[];
  tagSuggestions: readonly string[];
  timeZone: string;
  defaultCurrency: CurrencyCode;
  onModeChange: (mode: EntrySheetMode) => void;
  onClose: () => void;
  onSaved: (item: TransactionListItemDto, kind: 'created' | 'updated' | 'adjusted') => void;
}

const COPY = {
  create: {
    title: 'Add a transaction',
    description: 'Record money in, money out, or a move between your accounts.',
  },
  edit: {
    title: 'Edit transaction',
    description: 'Balances are recalculated from the corrected details.',
  },
  reconcile: {
    title: 'Correct a balance',
    description:
      'Compare with what your bank, cash count, or statement shows. CalmCash records the difference as an adjustment.',
  },
} as const;

/**
 * Transaction entry in a side sheet (full width on phones). Focus moves into the sheet, Escape
 * closes it, and a fresh form opens every time, so stale input never carries over.
 */
export function TransactionEntrySheet({
  mode,
  accounts,
  categories,
  tagSuggestions,
  timeZone,
  defaultCurrency,
  onModeChange,
  onClose,
  onSaved,
}: TransactionEntrySheetProps): ReactNode {
  const copy = COPY[mode?.kind ?? 'create'];
  const active = accounts.filter((entry) => entry.account.status === 'active');

  return (
    <Sheet
      open={mode !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
          <SheetTitle className="text-lg">{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>
        <div className="px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          {mode?.kind === 'reconcile' && (
            <ReconcileForm
              key={`reconcile-${mode.accountId ?? ''}`}
              accounts={active}
              initialAccountId={mode.accountId}
              timeZone={timeZone}
              onCancel={onClose}
              onSaved={(item) => {
                onSaved(item, 'adjusted');
              }}
            />
          )}
          {mode !== undefined && mode.kind !== 'reconcile' && (
            <TransactionForm
              key={mode.kind === 'edit' ? mode.item.transaction.id : `create-${mode.type}`}
              mode={mode}
              accounts={accounts.map((entry) => entry.account)}
              categories={categories}
              tagSuggestions={tagSuggestions}
              timeZone={timeZone}
              defaultCurrency={defaultCurrency}
              onCancel={onClose}
              onAdjustBalance={(accountId) => {
                onModeChange({ kind: 'reconcile', accountId });
              }}
              onSaved={(item) => {
                onSaved(item, mode.kind === 'edit' ? 'updated' : 'created');
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
