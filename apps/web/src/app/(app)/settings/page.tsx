import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  ActiveSessions,
  AppearanceSettings,
  ChangePasswordForm,
  ProfileSettings,
  ResetDisplayPreferences,
} from '@/features/settings';
import { NotificationPreferences } from '@/features/notifications';
import { SystemStatusCard } from '@/features/system-status';

export const metadata: Metadata = { title: 'Settings' };

function SettingsSection({
  id,
  title,
  description,
  children,
  anchor,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  /** Fragment that links straight to this section (e.g. from e-mails). */
  anchor?: string;
}): ReactNode {
  return (
    <section
      id={anchor}
      aria-labelledby={id}
      className="grid scroll-mt-[calc(var(--app-header-height)+1.5rem)] gap-4 border-b pb-8 last:border-b-0 last:pb-0 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-10"
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
      <PageHeader
        title="Settings"
        description="Your profile, how you sign in, notifications, and how CalmCash looks on this device."
      />

      <div className="flex flex-col gap-8">
        <SettingsSection
          id="profile-heading"
          title="Profile"
          description="Your name, and the currency and time zone CalmCash uses for money and dates."
        >
          <ProfileSettings />
        </SettingsSection>

        <SettingsSection
          id="password-heading"
          title="Password"
          description="Changing your password keeps you signed in here and signs out every other device."
        >
          <ChangePasswordForm />
        </SettingsSection>

        <SettingsSection
          id="sessions-heading"
          title="Where you are signed in"
          description="A session ends when you sign out, on its end date, or after a few days without use. Resetting your password ends all of them."
        >
          <ActiveSessions />
        </SettingsSection>

        <SettingsSection
          id="notifications-heading"
          anchor="notifications"
          title="Notifications"
          description="Choose which alerts and reminders you get, in the app and by e-mail, and how far ahead. Notifications only describe your money; they never record or move it."
        >
          <NotificationPreferences />
        </SettingsSection>

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
