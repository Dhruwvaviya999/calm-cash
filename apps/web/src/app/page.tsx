import type { ReactNode } from 'react';

import { PageShell } from '@/components/layout/page-shell';
import { SystemStatusCard } from '@/features/system-status';

export default function HomePage(): ReactNode {
  return (
    <PageShell>
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">CalmCash</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Your money, calmly organised.
        </h1>
        <p className="text-pretty text-muted-foreground">
          The project foundation is up and running. Accounts, budgets, statement imports, and AI
          insights will be built on top of it in the upcoming phases.
        </p>
      </header>

      <SystemStatusCard />
    </PageShell>
  );
}
