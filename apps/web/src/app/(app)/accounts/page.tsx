import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PageContainer } from '@/components/layout/page-container';
import { AccountsOverview } from '@/features/accounts';

export const metadata: Metadata = { title: 'Accounts' };

/** Live account management: every figure on this page comes from the API. */
export default function AccountsPage(): ReactNode {
  return (
    <PageContainer>
      <AccountsOverview />
    </PageContainer>
  );
}
