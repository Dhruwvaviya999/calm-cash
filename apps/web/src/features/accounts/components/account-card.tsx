import type { AccountWithBalanceDto } from '@calmcash/shared';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { Card } from '@/components/ui/card';
import { ACCOUNT_COLOR_PRESENTATION, ACCOUNT_TYPE_PRESENTATION } from '@/lib/finance-presentation';
import { cn } from '@/lib/utils';

import { AccountBalance } from './account-balance';

export interface AccountCardProps {
  entry: AccountWithBalanceDto;
  /** Opens the account's details. The whole card is the target; `actions` sit above it. */
  onOpen: () => void;
  /** Account-specific actions, e.g. a menu with edit and archive. */
  actions?: ReactNode;
}

/** Account icon tile in the account's colour (or neutral). */
export function AccountIcon({
  entry,
  className,
}: {
  entry: AccountWithBalanceDto;
  className?: string;
}): ReactNode {
  const { icon: Icon } = ACCOUNT_TYPE_PRESENTATION[entry.account.type];
  const tone =
    entry.account.color === undefined
      ? 'bg-muted text-foreground'
      : ACCOUNT_COLOR_PRESENTATION[entry.account.color].tileClassName;
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tone, className)}
    >
      <Icon className="size-5" />
    </span>
  );
}

/**
 * An account with its type, provider, currency, and balance as calculated by the API. Credit
 * cards show the amount owed, never a "balance" that could be mistaken for money held.
 */
export function AccountCard({ entry, onOpen, actions }: AccountCardProps): ReactNode {
  const { account } = entry;
  const { label } = ACCOUNT_TYPE_PRESENTATION[account.type];
  const titleId = `account-${account.id}-title`;

  return (
    <Card
      aria-labelledby={titleId}
      role="article"
      className={cn(
        'relative flex min-w-0 flex-col gap-4 p-4 transition-colors hover:bg-muted/40 sm:p-5',
        account.status === 'archived' && 'bg-muted/30',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AccountIcon entry={entry} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="truncate font-medium">
            <button
              type="button"
              onClick={onOpen}
              className="rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
            >
              {account.name}
            </button>
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {[label, account.institution, account.currency]
              .filter((part) => part !== undefined)
              .join(' · ')}
          </p>
        </div>
        {actions !== undefined && <div className="relative z-10 -mt-1 -mr-1">{actions}</div>}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <AccountBalance entry={entry} />
        {account.status === 'archived' && (
          <StatusBadge tone="neutral" className="relative">
            Archived
          </StatusBadge>
        )}
      </div>
    </Card>
  );
}
