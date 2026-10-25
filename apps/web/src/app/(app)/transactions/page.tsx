import { ArrowLeftRight } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { PlannedCapabilities } from '@/components/feedback/planned-capabilities';
import { StatusBadge } from '@/components/feedback/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { TransactionExplorer, TransactionRow, type ExplorerRow } from '@/features/transactions';
import { sampleTransactionItems } from '@/fixtures/sample-finances';

export const metadata: Metadata = { title: 'Transactions' };

/** Rows are rendered here on the server; the explorer only filters them on the client. */
const previewRows: ExplorerRow[] = sampleTransactionItems.map((item) => {
  const { transaction, account, category } = item;
  const merchant = transaction.type === 'transfer' ? '' : (transaction.merchant ?? '');
  return {
    id: transaction.id,
    type: transaction.type,
    searchText: [merchant, transaction.description, category?.name ?? '', account.name]
      .join(' ')
      .toLowerCase(),
    content: <TransactionRow item={item} />,
  };
});

export default function TransactionsPage(): ReactNode {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={<StatusBadge tone="upcoming">Coming soon</StatusBadge>}
        title="Transactions"
        description="Every debit and credit in one place, with who it was for and why."
      />

      <EmptyState
        icon={ArrowLeftRight}
        title="Your transaction history will live here"
        description="Soon you will be able to record every payment and transfer, note what each one was for, and find any of them in seconds."
      >
        <PlannedCapabilities
          label="Planned transaction features"
          items={[
            'Record debits, credits, and transfers between your accounts',
            'Capture the merchant, purpose, and category of every payment',
            'Search and filter your complete history',
          ]}
        />
      </EmptyState>

      <section aria-labelledby="transactions-preview-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="transactions-preview-heading"
          title="Preview: how your list will look"
          description="Sample transactions only. Search and filters work on this sample, nothing is saved."
          action={<StatusBadge tone="info">Sample data</StatusBadge>}
        />
        <TransactionExplorer rows={previewRows} />
      </section>
    </PageContainer>
  );
}
