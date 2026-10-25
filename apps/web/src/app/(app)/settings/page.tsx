import { CURRENCIES, DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from '@calmcash/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { AppearanceSettings, ResetDisplayPreferences } from '@/features/settings';
import { SystemStatusCard } from '@/features/system-status';

export const metadata: Metadata = { title: 'Settings' };

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-4 border-b pb-8 last:border-b-0 last:pb-0 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-10"
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SettingsPage(): ReactNode {
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Make CalmCash look and feel right for you." />

      <div className="flex flex-col gap-8">
        <SettingsSection
          id="appearance-heading"
          title="Appearance"
          description="Choose a theme. It is saved on this device and applied instantly."
        >
          <AppearanceSettings />
        </SettingsSection>

        <SettingsSection
          id="display-heading"
          title="Display preferences"
          description="Restore the default theme and sidebar layout on this device."
        >
          <ResetDisplayPreferences />
        </SettingsSection>

        <SettingsSection
          id="regional-heading"
          title="Currency and region"
          description="These defaults become editable once you have a CalmCash profile."
        >
          <Card className="divide-y">
            <dl className="divide-y">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <dt className="text-sm text-muted-foreground">Default currency</dt>
                <dd className="text-right text-sm font-medium">
                  {CURRENCIES[DEFAULT_CURRENCY].name} ({DEFAULT_CURRENCY})
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <dt className="text-sm text-muted-foreground">Time zone</dt>
                <dd className="text-right text-sm font-medium">{DEFAULT_TIMEZONE}</dd>
              </div>
            </dl>
            <p className="flex items-center gap-2 px-5 py-3 text-sm text-muted-foreground">
              <StatusBadge tone="upcoming">Coming soon</StatusBadge>
              Editing arrives with sign-in.
            </p>
          </Card>
        </SettingsSection>

        <SettingsSection
          id="diagnostics-heading"
          title="About and diagnostics"
          description="Connection details for troubleshooting. CalmCash keeps working if the service is briefly unavailable."
        >
          <SystemStatusCard />
        </SettingsSection>
      </div>
    </PageContainer>
  );
}
