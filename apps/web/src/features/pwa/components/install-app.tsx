'use client';

import { CheckCircle2, Download } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';

import { promptInstall, useInstallState } from '../install-store';

type Platform = 'ios' | 'safari-mac' | 'firefox' | 'other';

function detectPlatform(): Platform {
  const agent = navigator.userAgent;
  // iPadOS reports a desktop Safari agent; touch support tells them apart.
  if (
    /iPhone|iPad|iPod/.test(agent) ||
    (agent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  ) {
    return 'ios';
  }
  if (agent.includes('Firefox/')) return 'firefox';
  if (agent.includes('Safari/') && !/Chrome\/|Chromium\/|Edg\//.test(agent)) return 'safari-mac';
  return 'other';
}

const noSubscription = (): (() => void) => () => undefined;

const MANUAL_STEPS: Record<Platform, string> = {
  ios: 'In Safari, tap the Share button, then “Add to Home Screen”.',
  'safari-mac': 'In Safari, choose File › “Add to Dock”.',
  firefox:
    'Firefox for Android: open the menu and choose “Install”. Firefox on a computer cannot install web apps; use Chrome, Edge, or Safari instead.',
  other:
    'Use the install icon in the address bar, or open the browser menu and choose “Install CalmCash” (or “Add to Home screen”).',
};

/**
 * Settings entry point for installing CalmCash. Shows the browser's install dialog where the
 * browser offers one (Chromium), the manual steps elsewhere, and nothing to do once installed.
 * It never prompts by itself.
 */
export function InstallApp(): ReactNode {
  const { canPrompt, standalone, installed } = useInstallState();
  // The browser is only known on the client; nothing platform-specific is rendered on the server.
  const platform = useSyncExternalStore<Platform | undefined>(
    noSubscription,
    detectPlatform,
    () => undefined,
  );
  const [outcome, setOutcome] = useState<'dismissed' | undefined>();

  if (standalone || installed) {
    return (
      <FormMessage tone="success" title="CalmCash is installed">
        {standalone
          ? 'You are using the installed app.'
          : 'Open CalmCash from your home screen or app list.'}
      </FormMessage>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Installing adds CalmCash to your home screen or app list and opens it in its own window. It
        uses the same account and data as this browser and needs a connection to show your money.
      </p>
      {canPrompt ? (
        <Button
          type="button"
          className="h-11 self-start sm:h-9"
          onClick={() => {
            void promptInstall().then((result) => {
              if (result === 'dismissed') setOutcome('dismissed');
            });
          }}
        >
          <Download aria-hidden="true" />
          Install CalmCash
        </Button>
      ) : (
        platform !== undefined && (
          <p className="flex items-start gap-2">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{MANUAL_STEPS[platform]}</span>
          </p>
        )
      )}
      {outcome === 'dismissed' && (
        <p className="text-muted-foreground">
          Not installed. You can install it any time from the browser menu.
        </p>
      )}
    </div>
  );
}
