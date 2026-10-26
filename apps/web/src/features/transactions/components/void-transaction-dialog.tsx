'use client';

import { TEXT_LIMITS } from '@calmcash/shared';
import { useState, type ReactNode } from 'react';

import { FormField } from '@/components/forms/form-field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';

export interface VoidTransactionDialogProps {
  /** How many transactions would be voided; the dialog is closed while `undefined`. */
  count: number | undefined;
  /** Name of the single transaction, for the title. */
  title?: string | undefined;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
}

/**
 * Confirms voiding with an optional reason. Voiding is reversible: the transaction is kept, stops
 * counting toward balances and totals, and can be restored from the Voided view.
 */
export function VoidTransactionDialog({
  count,
  title,
  onCancel,
  onConfirm,
}: VoidTransactionDialogProps): ReactNode {
  const [reason, setReason] = useState('');
  const plural = count !== undefined && count > 1;

  return (
    <AlertDialog
      open={count !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          onCancel();
        }
      }}
    >
      <AlertDialogContent className="rounded-2xl bg-card max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {plural
              ? `Void ${String(count)} transactions?`
              : `Void ${title ?? 'this transaction'}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {plural ? 'They stop' : 'It stops'} counting toward balances and totals but stay in your
            records under Voided, where you can restore {plural ? 'them' : 'it'} at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormField id="void-reason" label="Reason (optional)">
          {(control) => (
            <Input
              {...control}
              value={reason}
              maxLength={TEXT_LIMITS.transactionVoidReason}
              placeholder="e.g. Recorded twice"
              className="h-11"
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
        <AlertDialogFooter>
          <AlertDialogCancel className="max-sm:h-11">Keep</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="max-sm:h-11"
            onClick={() => {
              const trimmed = reason.trim();
              setReason('');
              onConfirm(trimmed === '' ? undefined : trimmed);
            }}
          >
            {plural ? 'Void transactions' : 'Void transaction'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
