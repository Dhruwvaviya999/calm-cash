'use client';

import { parseMinorUnits, type AccountWithBalanceDto } from '@calmcash/shared';
import { ArchiveRestore, Archive, ArrowLeftRight, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  ACCOUNT_CLASSIFICATION_LABELS,
  ACCOUNT_TYPE_PRESENTATION,
} from '@/lib/finance-presentation';

import { AccountBalance } from './account-balance';
import { AccountIcon } from './account-card';

export interface AccountDetailsSheetProps {
  entry: AccountWithBalanceDto | undefined;
  timeZone: string;
  onClose: () => void;
  onEdit: (entry: AccountWithBalanceDto) => void;
  onArchive: (entry: AccountWithBalanceDto) => void;
  onRestore: (entry: AccountWithBalanceDto) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** Everything known about one account. There is no transaction history yet, so none is shown. */
export function AccountDetailsSheet({
  entry,
  timeZone,
  onClose,
  onEdit,
  onArchive,
  onRestore,
}: AccountDetailsSheetProps): ReactNode {
  return (
    <Sheet
      open={entry !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {entry !== undefined && (
          <Details entry={entry} timeZone={timeZone} {...{ onEdit, onArchive, onRestore }} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({
  entry,
  timeZone,
  onEdit,
  onArchive,
  onRestore,
}: Omit<AccountDetailsSheetProps, 'entry' | 'onClose'> & {
  entry: AccountWithBalanceDto;
}): ReactNode {
  const { account, balance } = entry;
  const liability = account.classification === 'liability';
  const opening = parseMinorUnits(account.openingBalanceMinor);

  return (
    <>
      <SheetHeader className="gap-3 border-b px-5 pt-5 pr-14 pb-4">
        <div className="flex items-center gap-3">
          <AccountIcon entry={entry} />
          <div className="min-w-0">
            <SheetTitle className="truncate text-lg">{account.name}</SheetTitle>
            <SheetDescription>
              {ACCOUNT_TYPE_PRESENTATION[account.type].label} ·{' '}
              {ACCOUNT_CLASSIFICATION_LABELS[account.classification]}
            </SheetDescription>
          </div>
        </div>
        {account.status === 'archived' && (
          <StatusBadge tone="neutral" className="self-start">
            Archived
          </StatusBadge>
        )}
      </SheetHeader>

      <div className="flex flex-col gap-6 px-5 py-5">
        <AccountBalance entry={entry} size="display" />

        <dl className="divide-y border-y">
          <Row label="Currency">{account.currency}</Row>
          {account.institution !== undefined && <Row label="Provider">{account.institution}</Row>}
          <Row label={liability ? 'Owed when you started' : 'Opening balance'}>
            <FinancialAmount
              amountMinor={(liability ? -opening : opening).toString()}
              currency={account.currency}
              size="sm"
            />
            <span className="block text-xs font-normal text-muted-foreground">
              as of {formatDate(account.openingBalanceDate, 'fullDate')}
            </span>
          </Row>
          {account.creditLimitMinor !== undefined && (
            <Row label="Credit limit">
              <FinancialAmount
                amountMinor={account.creditLimitMinor}
                currency={account.currency}
                size="sm"
              />
            </Row>
          )}
          <Row label="Added">{formatDateTime(account.createdAt, timeZone)}</Row>
          {account.archivedAt !== undefined && (
            <Row label="Archived">{formatDateTime(account.archivedAt, timeZone)}</Row>
          )}
        </dl>

        <section aria-labelledby="account-history-heading" className="flex flex-col gap-2">
          <h3 id="account-history-heading" className="text-sm font-semibold">
            Transactions
          </h3>
          <div className="flex items-start gap-3 rounded-xl border border-dashed bg-card/60 p-4 text-sm text-muted-foreground">
            <ArrowLeftRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>
              {balance.countedTransactions === 0
                ? 'Transactions will appear here once you can record them in CalmCash. Until then the balance equals the opening balance.'
                : `${balance.countedTransactions} recorded transactions are included in this balance.`}
            </p>
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          {account.status === 'active' ? (
            <>
              <Button
                className="h-11 sm:h-9"
                onClick={() => {
                  onEdit(entry);
                }}
              >
                <Pencil aria-hidden="true" />
                Edit account
              </Button>
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => {
                  onArchive(entry);
                }}
              >
                <Archive aria-hidden="true" />
                Archive
              </Button>
            </>
          ) : (
            <Button
              className="h-11 sm:h-9"
              onClick={() => {
                onRestore(entry);
              }}
            >
              <ArchiveRestore aria-hidden="true" />
              Restore account
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
