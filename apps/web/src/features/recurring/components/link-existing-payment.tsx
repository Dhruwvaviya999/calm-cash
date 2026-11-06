'use client';

import type { RecordedOccurrenceDto, UpcomingOccurrenceDto } from '@calmcash/shared';
import { Link2, LoaderCircle } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { getLinkCandidates, linkOccurrence } from '@/services/recurring.service';

export interface LinkExistingPaymentProps {
  target: UpcomingOccurrenceDto;
  timeZone: string;
  onLinked: (result: RecordedOccurrenceDto) => void;
}

/**
 * "Already recorded it?" — lists transactions the person already has (typed in or imported from a
 * statement) that could be this payment, and settles the payment with the chosen one. Nothing new
 * is recorded and no balance changes, so the money is never counted twice.
 */
export function LinkExistingPayment({
  target,
  timeZone,
  onLinked,
}: LinkExistingPaymentProps): ReactNode {
  const { scheduleId, scheduledDate } = target.occurrence;
  const load = useCallback(
    (signal: AbortSignal) => getLinkCandidates(scheduleId, scheduledDate, signal),
    [scheduleId, scheduledDate],
  );
  const { state } = useAsyncResource(load);
  const [linking, setLinking] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Looking for a matching transaction…
      </p>
    );
  }
  // Offering a link is optional: when the lookup fails or finds nothing, recording still works.
  if (state.status === 'error' || state.data.candidates.length === 0) {
    return null;
  }

  const link = async (transactionId: string): Promise<void> => {
    setError(undefined);
    setLinking(transactionId);
    try {
      onLinked(await linkOccurrence(scheduleId, scheduledDate, transactionId));
    } catch (caught: unknown) {
      setError(describeRequestError(caught));
    } finally {
      setLinking(undefined);
    }
  };

  return (
    <section aria-labelledby="link-existing-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="link-existing-heading" className="text-sm font-semibold text-foreground">
          Already recorded this payment?
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose the transaction it was paid with. Nothing new is recorded and no balance changes.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {state.data.candidates.map(({ transaction, account }) => (
          <li
            key={transaction.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {transaction.description}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(transaction.occurredAt, 'dayMonthYear', timeZone)} · {account.name} ·{' '}
                {formatMoney(transaction.amountMinor, transaction.currency)}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 sm:h-9"
              disabled={linking !== undefined}
              aria-label={`Use ${transaction.description} on ${formatDate(transaction.occurredAt, 'dayMonthYear', timeZone)}`}
              onClick={() => void link(transaction.id)}
            >
              {linking === transaction.id ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Link2 aria-hidden="true" className="size-4" />
              )}
              Use this
            </Button>
          </li>
        ))}
      </ul>
      {error !== undefined && (
        <FormMessage tone="error" title="Nothing was linked">
          {error}
        </FormMessage>
      )}
      <p className="border-t border-border pt-4 text-sm text-muted-foreground">
        Or record it as a new transaction:
      </p>
    </section>
  );
}
