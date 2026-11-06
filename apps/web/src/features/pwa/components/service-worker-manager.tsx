'use client';

import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { watchInstallability } from '../install-store';

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Production builds only; `NEXT_PUBLIC_SERVICE_WORKER=off` removes an installed worker. */
function serviceWorkerWanted(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SERVICE_WORKER !== 'off';
}

/**
 * Registers the service worker (secure contexts only), keeps an eye out for new versions, and
 * tells the person when one is ready. Switching only happens when they choose "Reload now": an
 * update never reloads the page on its own, so a half-filled form or an import review survives.
 * Also starts the install-prompt listener used by Settings.
 */
export function ServiceWorkerManager(): ReactNode {
  const [waiting, setWaiting] = useState<ServiceWorker | undefined>();

  useEffect(() => watchInstallability(), []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    const container = navigator.serviceWorker;
    if (!serviceWorkerWanted()) {
      // Kill switch: a deployment with the worker turned off removes it from every browser.
      void container
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        );
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let reloading = false;

    const offer = (worker: ServiceWorker | null): void => {
      // Without a controller this is the first install, not an update.
      if (worker !== null && container.controller !== null) setWaiting(worker);
    };
    const track = (found: ServiceWorkerRegistration): void => {
      registration = found;
      offer(found.waiting);
      found.addEventListener('updatefound', () => {
        const installing = found.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') offer(installing);
        });
      });
    };
    const check = (): void => {
      // A failed check (offline, server error) keeps the current version; nothing to report.
      registration?.update().catch(() => undefined);
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    const onControllerChange = (): void => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    container
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(track)
      .catch(() => undefined); // The app works the same without it; only offline support is lost.
    container.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(check, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      container.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, []);

  if (waiting === undefined) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 mx-auto flex max-w-md flex-col gap-3 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg md:right-6 md:bottom-6 md:left-auto md:mx-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium">A new version of CalmCash is ready</p>
          <p className="text-muted-foreground">
            Finish or save what you are working on, then reload to use it.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remind me later"
          onClick={() => {
            setWaiting(undefined);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <Button
        type="button"
        className="h-11 self-start sm:h-9"
        onClick={() => {
          waiting.postMessage({ type: 'SKIP_WAITING' });
        }}
      >
        <RefreshCw aria-hidden="true" />
        Reload now
      </Button>
    </div>
  );
}
