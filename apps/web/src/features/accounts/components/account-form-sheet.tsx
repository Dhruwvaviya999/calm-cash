'use client';

import type { AccountWithBalanceDto, CurrencyCode } from '@calmcash/shared';
import type { ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { AccountForm, type AccountFormMode } from './account-form';

export interface AccountFormSheetProps {
  /** `undefined` closes the sheet. */
  mode: AccountFormMode | undefined;
  defaultCurrency: CurrencyCode;
  timeZone: string;
  onClose: () => void;
  onSaved: (entry: AccountWithBalanceDto, kind: 'created' | 'updated') => void;
}

/**
 * The account form in a side sheet: full width on phones, a panel on larger screens. Focus moves
 * into the sheet, Escape closes it, and focus returns to the control that opened it.
 */
export function AccountFormSheet({
  mode,
  defaultCurrency,
  timeZone,
  onClose,
  onSaved,
}: AccountFormSheetProps): ReactNode {
  const editing = mode?.kind === 'edit';

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
          <SheetTitle className="text-lg">{editing ? 'Edit account' : 'Add an account'}</SheetTitle>
          <SheetDescription>
            {editing
              ? 'Update how this account is described. Its history is kept as it is.'
              : 'Add a place your money lives, or a card you owe on. You can add more any time.'}
          </SheetDescription>
        </SheetHeader>
        <div className="px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          {mode !== undefined && (
            <AccountForm
              // A fresh form for every open, so stale input never carries over.
              key={mode.kind === 'edit' ? mode.entry.account.id : 'create'}
              mode={mode}
              defaultCurrency={defaultCurrency}
              timeZone={timeZone}
              onCancel={onClose}
              onSaved={(entry) => {
                onSaved(entry, mode.kind === 'edit' ? 'updated' : 'created');
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
