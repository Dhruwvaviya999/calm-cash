import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PageContainer } from '@/components/layout/page-container';
import { NotificationsPage } from '@/features/notifications';

export const metadata: Metadata = { title: 'Notifications' };

/** The notification center: every notification, read, followed, or dismissed here. */
export default function NotificationsRoute(): ReactNode {
  return (
    <PageContainer>
      <NotificationsPage />
    </PageContainer>
  );
}
