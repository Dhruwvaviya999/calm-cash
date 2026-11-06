import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { OfflineRetry } from '@/features/pwa/components/offline-retry';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };

/**
 * Shown by the service worker in place of any page that cannot be loaded because the network is
 * unreachable (the address bar keeps the page that was asked for). Static and personal-data free:
 * it shows no figures, because nothing can be checked against the server while offline.
 */
export default function OfflinePage(): ReactNode {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center">
      <Wordmark />
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">You are offline</h1>
        <p className="text-muted-foreground">
          CalmCash needs a connection to show your accounts and save changes, so nothing is shown
          from an old copy. Your data is safe on the server. Check your connection and try again.
        </p>
      </div>
      <OfflineRetry />
    </main>
  );
}
