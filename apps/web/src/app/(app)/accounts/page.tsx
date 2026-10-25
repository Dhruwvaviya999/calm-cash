import { WalletCards } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { PlannedCapabilities } from '@/components/feedback/planned-capabilities';
import { StatusBadge } from '@/components/feedback/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { AccountCard } from '@/features/accounts';
import { sampleAccountBalances } from '@/fixtures/sample-finances';

export const metadata: Metadata = { title: 'Accounts' };

export default function AccountsPage(): ReactNode {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={<StatusBadge tone="upcoming">Coming soon</StatusBadge>}
        title="Accounts"
        description="Bank accounts, credit cards, cash, and wallets, all in one view."
      />

      <EmptyState
        icon={WalletCards}
        title="Bring your accounts together"
        description="Add the places your money lives so every transaction is linked to where it was paid from or received into."
      >
        <PlannedCapabilities
          label="Planned account features"
          items={[
            'Bank, card, cash, wallet, investment, and loan accounts',
            'Opening balances and accurate running balances',
            'Transfers between your own accounts that never count as spending',
          ]}
        />
      </EmptyState>

      <section aria-labelledby="accounts-preview-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="accounts-preview-heading"
          title="Preview: how accounts will look"
          description="Sample accounts and balances, to show the layout."
          action={<StatusBadge tone="info">Sample data</StatusBadge>}
        />
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sampleAccountBalances.map(({ account, balanceMinor }) => (
            <li key={account.id}>
              <AccountCard account={account} balanceMinor={balanceMinor} />
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
