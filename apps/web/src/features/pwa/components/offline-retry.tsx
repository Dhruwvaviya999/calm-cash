'use client';

import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { useOnline } from './connection-status';

/** Connection status and retry for the offline page; reloads by itself once back online. */
export function OfflineRetry(): ReactNode {
  const online = useOnline();

  useEffect(() => {
    // Reloading asks again for the page the person wanted (the address bar still shows it).
    const reload = (): void => {
      window.location.reload();
    };
    window.addEventListener('online', reload);
    return () => {
      window.removeEventListener('online', reload);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-foreground">
        {online ? (
          <>
            <Wifi aria-hidden="true" className="size-4 text-primary" />
            Connection detected — the server may still be unreachable.
          </>
        ) : (
          <>
            <WifiOff aria-hidden="true" className="size-4 text-muted-foreground" />
            No connection
          </>
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          className="h-11"
          onClick={() => {
            window.location.reload();
          }}
        >
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
        <Button asChild variant="outline" className="h-11">
          <a href="/dashboard">Go to the dashboard</a>
        </Button>
      </div>
    </div>
  );
}
