import type {
  CurrencyCode,
  MinorUnitsString,
  TransactionDto,
  TransactionType,
} from '@calmcash/shared';
import type { ReactNode } from 'react';

import { formatMoneyMagnitude, formatMoneyMagnitudeToParts, MINUS_SIGN } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * How an amount affects the user: money in, money out, moved between accounts, a balance
 * correction up or down, or a balance.
 */
export type AmountDirection =
  'credit' | 'debit' | 'transfer' | 'adjustment-up' | 'adjustment-down' | 'balance';

/** Direction by type alone; balance adjustments need `directionForTransaction`. */
export function directionForTransactionType(
  type: Exclude<TransactionType, 'balance_adjustment'>,
): AmountDirection {
  switch (type) {
    case 'income':
      return 'credit';
    case 'expense':
      return 'debit';
    case 'transfer':
      return 'transfer';
  }
}

export function directionForTransaction(transaction: TransactionDto): AmountDirection {
  return transaction.type === 'balance_adjustment'
    ? transaction.adjustmentDirection === 'increase'
      ? 'adjustment-up'
      : 'adjustment-down'
    : directionForTransactionType(transaction.type);
}

const DIRECTION_STYLES: Readonly<Record<AmountDirection, { srLabel: string; className: string }>> =
  {
    credit: { srLabel: 'Credit', className: 'text-income' },
    debit: { srLabel: 'Debit', className: 'text-expense' },
    transfer: { srLabel: 'Transfer', className: 'text-transfer' },
    // Corrections are neither income nor spending, so they stay neutral in colour.
    'adjustment-up': { srLabel: 'Balance adjusted up by', className: 'text-foreground' },
    'adjustment-down': { srLabel: 'Balance adjusted down by', className: 'text-foreground' },
    balance: { srLabel: '', className: 'text-foreground' },
  };

const SIZE_CLASSES = {
  sm: 'text-sm font-medium',
  md: 'text-[0.9375rem] font-semibold',
  lg: 'text-lg font-semibold tracking-tight sm:text-xl',
  display: 'text-4xl font-semibold tracking-tight sm:text-5xl',
} as const;

export interface FinancialAmountProps {
  /** Minor units as a canonical string, e.g. `"245000"` for ₹2,450.00. Signed for balances. */
  amountMinor: MinorUnitsString;
  currency: CurrencyCode;
  /** Defaults to `balance`, which shows the signed value without a direction label. */
  direction?: AmountDirection;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

function signFor(direction: AmountDirection, negative: boolean): string {
  if (direction === 'credit' || direction === 'adjustment-up') return '+';
  if (direction === 'debit' || direction === 'adjustment-down') return MINUS_SIGN;
  if (direction === 'balance' && negative) return MINUS_SIGN;
  return '';
}

/**
 * Formats money exactly (no floating point) with tabular figures. Direction is conveyed by the
 * sign and a screen-reader label as well as colour, so it never relies on colour alone.
 */
export function FinancialAmount({
  amountMinor,
  currency,
  direction = 'balance',
  size = 'md',
  className,
}: FinancialAmountProps): ReactNode {
  const negative = amountMinor.startsWith('-');
  const sign = signFor(direction, negative);
  const { srLabel, className: directionClassName } = DIRECTION_STYLES[direction];
  const srPrefix = direction === 'balance' && negative ? 'Negative' : srLabel;

  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        SIZE_CLASSES[size],
        directionClassName,
        className,
      )}
    >
      {srPrefix !== '' && <span className="sr-only">{srPrefix} </span>}
      {sign !== '' && <span aria-hidden="true">{sign}</span>}
      {size === 'display'
        ? formatMoneyMagnitudeToParts(amountMinor, currency).map((part, index) =>
            part.type === 'decimal' || part.type === 'fraction' ? (
              <span key={index} className="text-[0.55em] text-muted-foreground">
                {part.value}
              </span>
            ) : (
              <span key={index}>{part.value}</span>
            ),
          )
        : formatMoneyMagnitude(amountMinor, currency)}
    </span>
  );
}
