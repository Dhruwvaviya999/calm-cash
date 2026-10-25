import { Compass, LayoutDashboard } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound(): ReactNode {
  return (
    <PageShell>
      <EmptyState
        icon={Compass}
        headingLevel="h1"
        badge={<p className="text-sm font-semibold text-primary">Error 404</p>}
        title="This page does not exist"
        description="The address may be mistyped, or the page has moved. Your dashboard is a good place to start again."
      >
        <Button asChild>
          <Link href="/dashboard">
            <LayoutDashboard aria-hidden="true" />
            Go to dashboard
          </Link>
        </Button>
      </EmptyState>
    </PageShell>
  );
}
