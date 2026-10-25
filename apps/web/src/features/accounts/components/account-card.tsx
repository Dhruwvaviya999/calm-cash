import type { AccountDto, MinorUnitsString } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { FinancialAmount } from '@/components/finance/financial-amount';
import { Card } from '@/components/ui/card';
import { ACCOUNT_TYPE_PRESENTATION } from '@/lib/finance-presentation';

export interface AccountCardProps {
  account: AccountDto;
  /** Balance to display. Supplied by the caller; this component never calculates balances. */
  balanceMinor: MinorUnitsString;
}

/** An account with its type, currency, and balance. Negative balances (e.g. cards) read as owed. */
export function AccountCard({ account, balanceMinor }: AccountCardProps): ReactNode {
  const { icon: Icon, label } = ACCOUNT_TYPE_PRESENTATION[account.type];
  const owed = balanceMinor.startsWith('-');

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{account.name}</p>
          <p className="text-sm text-muted-foreground">
            {label} · {account.currency}
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{owed ? 'Amount owed' : 'Balance'}</p>
        <FinancialAmount amountMinor={balanceMinor} currency={account.currency} size="lg" />
      </div>
    </Card>
  );
}
