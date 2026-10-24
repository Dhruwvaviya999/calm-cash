import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageShell } from '@/components/layout/page-shell';
import { outlineButtonClasses } from '@/components/ui/button-classes';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound(): ReactNode {
  return (
    <PageShell>
      <div className="space-y-4">
        <p className="text-sm font-semibold text-accent">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <Link href="/" className={outlineButtonClasses}>
          Back to home
        </Link>
      </div>
    </PageShell>
  );
}
