import { parseMinorUnits, type AccountWithBalanceDto } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface BalanceFigure {
  label: string;
  /** Always shown as a positive magnitude with the label carrying the meaning. */
  amountMinor: string;
  tone: 'held' | 'owed' | 'credit' | 'overdrawn';
}

function negate(value: string): string {
  return (-parseMinorUnits(value)).toString();
}

/**
 * The headline figure of an account. Assets show money held (or "Overdrawn" below zero);
 * liabilities show the amount owed (or "In credit"), so a debt is never presented as money owned.
 */
export function getBalanceFigure({ account, balance }: AccountWithBalanceDto): BalanceFigure {
  if (account.classification === 'liability') {
    const owed = balance.amountOwedMinor ?? negate(balance.currentBalanceMinor);
    return owed.startsWith('-')
      ? { label: 'In credit', amountMinor: negate(owed), tone: 'credit' }
      : { label: 'Amount owed', amountMinor: owed, tone: 'owed' };
  }
  return balance.currentBalanceMinor.startsWith('-')
    ? { label: 'Overdrawn', amountMinor: negate(balance.currentBalanceMinor), tone: 'overdrawn' }
    : { label: 'Balance', amountMinor: balance.currentBalanceMinor, tone: 'held' };
}

const TONE_CLASSES: Readonly<Record<BalanceFigure['tone'], string>> = {
  held: 'text-foreground',
  credit: 'text-income',
  owed: 'text-expense',
  overdrawn: 'text-expense',
};

export function AccountBalance({
  entry,
  size = 'lg',
}: {
  entry: AccountWithBalanceDto;
  size?: 'md' | 'lg' | 'display';
}): ReactNode {
  const figure = getBalanceFigure(entry);
  const { account, balance } = entry;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{figure.label}</p>
      <FinancialAmount
        amountMinor={figure.amountMinor}
        currency={account.currency}
        size={size}
        className={cn(TONE_CLASSES[figure.tone])}
      />
      {balance.availableCreditMinor !== undefined && account.creditLimitMinor !== undefined && (
        <p className="text-xs text-muted-foreground">
          {balance.availableCreditMinor.startsWith('-')
            ? `${formatMoney(negate(balance.availableCreditMinor), account.currency)} over the ${formatMoney(account.creditLimitMinor, account.currency)} limit`
            : `${formatMoney(balance.availableCreditMinor, account.currency)} available of ${formatMoney(account.creditLimitMinor, account.currency)}`}
        </p>
      )}
    </div>
  );
}
