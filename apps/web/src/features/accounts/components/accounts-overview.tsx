'use client';

import type { AccountSummaryDto, AccountWithBalanceDto } from '@calmcash/shared';
import { Archive, ArchiveRestore, Ellipsis, Eye, Pencil, Plus, WalletCards } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { FilterOptions } from '@/components/forms/filter-bar';
import { FormMessage } from '@/components/forms/form-message';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { ACCOUNT_CLASSIFICATION_LABELS } from '@/lib/finance-presentation';
import { describeRequestError } from '@/lib/form-errors';
import {
  archiveAccount,
  getAccountSummary,
  listAccounts,
  restoreAccount,
} from '@/services/accounts.service';

import { AccountCard } from './account-card';
import { AccountDetailsSheet } from './account-details-sheet';
import type { AccountFormMode } from './account-form';
import { AccountFormSheet } from './account-form-sheet';
import { AccountsSummary } from './accounts-summary';

type View = 'active' | 'archived';

const VIEW_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const;

interface AccountsData {
  accounts: AccountWithBalanceDto[];
  summary: AccountSummaryDto | undefined;
}

type Notice = { tone: 'success' | 'error'; message: string } | undefined;

function AccountsSkeleton(): ReactNode {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading your accounts…</span>
      <Skeleton aria-hidden="true" className="h-28 rounded-2xl bg-muted" />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-36 rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

function AccountActions({
  entry,
  onDetails,
  onEdit,
  onArchive,
  onRestore,
}: {
  entry: AccountWithBalanceDto;
  onDetails: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}): ReactNode {
  const active = entry.account.status === 'active';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${entry.account.name}`}
          className="size-10 rounded-full"
        >
          <Ellipsis aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onDetails}>
          <Eye aria-hidden="true" />
          View details
        </DropdownMenuItem>
        {active ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              <Archive aria-hidden="true" />
              Archive
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={onRestore}>
            <ArchiveRestore aria-hidden="true" />
            Restore
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The live Accounts page: totals per currency, accounts grouped into money held and money owed,
 * and create, edit, archive, and restore. All figures come from the API; nothing is stored in
 * the browser.
 */
export function AccountsOverview(): ReactNode {
  const { user } = useSignedInSession();
  const [view, setView] = useState<View>('active');
  const load = useCallback(
    async (signal: AbortSignal): Promise<AccountsData> => {
      const [list, summary] = await Promise.all([
        listAccounts(view, signal),
        view === 'active' ? getAccountSummary(signal) : Promise.resolve(undefined),
      ]);
      return { accounts: list.accounts, summary };
    },
    [view],
  );
  const { state, reload, refresh } = useAsyncResource(load);

  const [formMode, setFormMode] = useState<AccountFormMode | undefined>();
  const [detailsId, setDetailsId] = useState<string | undefined>();
  const [archiveTarget, setArchiveTarget] = useState<AccountWithBalanceDto | undefined>();
  const [notice, setNotice] = useState<Notice>();

  const accounts = state.status === 'success' ? state.data.accounts : [];
  const details = accounts.find((entry) => entry.account.id === detailsId);

  const openCreate = (): void => {
    setNotice(undefined);
    setFormMode({ kind: 'create' });
  };

  const runAction = async (
    action: () => Promise<AccountWithBalanceDto>,
    success: (entry: AccountWithBalanceDto) => string,
  ): Promise<void> => {
    setNotice(undefined);
    try {
      const entry = await action();
      setNotice({ tone: 'success', message: success(entry) });
      refresh();
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    }
  };

  const restore = (entry: AccountWithBalanceDto): void => {
    void runAction(
      () => restoreAccount(entry.account.id),
      (restored) => `${restored.account.name} is active again.`,
    );
  };

  const renderGroup = (title: string, id: string, entries: AccountWithBalanceDto[]): ReactNode =>
    entries.length === 0 ? null : (
      <section aria-labelledby={id} className="flex flex-col gap-3">
        <SectionHeader id={id} title={title} />
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <li key={entry.account.id} className="min-w-0">
              <AccountCard
                entry={entry}
                onOpen={() => {
                  setDetailsId(entry.account.id);
                }}
                actions={
                  <AccountActions
                    entry={entry}
                    onDetails={() => {
                      setDetailsId(entry.account.id);
                    }}
                    onEdit={() => {
                      setNotice(undefined);
                      setFormMode({ kind: 'edit', entry });
                    }}
                    onArchive={() => {
                      setArchiveTarget(entry);
                    }}
                    onRestore={() => {
                      restore(entry);
                    }}
                  />
                }
              />
            </li>
          ))}
        </ul>
      </section>
    );

  let content: ReactNode;
  if (state.status === 'loading') {
    content = <AccountsSkeleton />;
  } else if (state.status === 'error') {
    content = (
      <ErrorState
        title="Your accounts could not be loaded"
        description={`${describeRequestError(state.error)} Nothing has been lost.`}
        onRetry={reload}
      />
    );
  } else if (state.data.accounts.length === 0) {
    content =
      view === 'active' ? (
        <EmptyState
          icon={WalletCards}
          title="Add your first account"
          description="Start with the account you use most: a bank account, a credit card, or the cash in your wallet. CalmCash uses accounts to show what you hold and what you owe."
        >
          <div className="flex flex-col items-center gap-4">
            <Button size="lg" className="h-11" onClick={openCreate}>
              <Plus aria-hidden="true" />
              Add an account
            </Button>
            <p className="text-sm text-muted-foreground">
              No bank logins or card numbers needed. You can add more accounts later.
            </p>
          </div>
        </EmptyState>
      ) : (
        <EmptyState
          icon={Archive}
          title="No archived accounts"
          description="Accounts you archive appear here, with their balances and history intact. You can restore them at any time."
        />
      );
  } else {
    const assets = state.data.accounts.filter((entry) => entry.account.classification === 'asset');
    const liabilities = state.data.accounts.filter(
      (entry) => entry.account.classification === 'liability',
    );
    content = (
      <div className="flex flex-col gap-8">
        {state.data.summary !== undefined && <AccountsSummary summary={state.data.summary} />}
        {view === 'active' ? (
          <>
            {renderGroup(ACCOUNT_CLASSIFICATION_LABELS.asset, 'accounts-assets-heading', assets)}
            {renderGroup(
              ACCOUNT_CLASSIFICATION_LABELS.liability,
              'accounts-liabilities-heading',
              liabilities,
            )}
          </>
        ) : (
          renderGroup('Archived accounts', 'accounts-archived-heading', state.data.accounts)
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Your bank accounts, cards, cash, and wallets, with balances kept exact."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            Add account
          </Button>
        }
      />

      <FilterOptions
        legend="Show accounts"
        name="account-view"
        options={VIEW_OPTIONS}
        value={view}
        onValueChange={(next) => {
          setNotice(undefined);
          setDetailsId(undefined);
          setView(next);
        }}
      />

      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}

      <div aria-busy={state.status === 'loading'}>{content}</div>

      <AccountFormSheet
        mode={formMode}
        defaultCurrency={user.preferredCurrency}
        timeZone={user.timezone}
        onClose={() => {
          setFormMode(undefined);
        }}
        onSaved={(entry, kind) => {
          setFormMode(undefined);
          setNotice({
            tone: 'success',
            message:
              kind === 'created'
                ? `${entry.account.name} was added.`
                : `${entry.account.name} was updated.`,
          });
          if (kind === 'created' && view !== 'active') {
            setView('active');
          } else {
            refresh();
          }
        }}
      />

      <AccountDetailsSheet
        entry={details}
        timeZone={user.timezone}
        onClose={() => {
          setDetailsId(undefined);
        }}
        onEdit={(entry) => {
          setDetailsId(undefined);
          setFormMode({ kind: 'edit', entry });
        }}
        onArchive={(entry) => {
          setDetailsId(undefined);
          setArchiveTarget(entry);
        }}
        onRestore={(entry) => {
          setDetailsId(undefined);
          restore(entry);
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setArchiveTarget(undefined);
          }
        }}
        title={
          archiveTarget === undefined
            ? 'Archive account?'
            : `Archive ${archiveTarget.account.name}?`
        }
        description="It moves to Archived and can no longer be used for new activity. Its balance and history are kept, and you can restore it at any time."
        confirmLabel="Archive account"
        destructive
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(undefined);
          if (target !== undefined) {
            void runAction(
              () => archiveAccount(target.account.id),
              (archived) =>
                `${archived.account.name} was archived. You can find it under Archived.`,
            );
          }
        }}
      />
    </>
  );
}
