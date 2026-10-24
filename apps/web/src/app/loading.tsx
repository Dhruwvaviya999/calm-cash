import type { ReactNode } from 'react';

import { PageShell } from '@/components/layout/page-shell';

export default function Loading(): ReactNode {
  return (
    <PageShell>
      <p role="status" className="text-sm text-muted-foreground">
        Loading…
      </p>
    </PageShell>
  );
}
