'use client';

import { WifiOff } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** `navigator.onLine` as React state; assumed online on the server and before hydration. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * A banner while the device reports no connection. Figures already on screen were loaded earlier
 * and may be out of date, and nothing can be saved until the connection returns — say so plainly
 * instead of presenting them as current.
 */
export function ConnectionStatus(): ReactNode {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-warning/40 bg-warning px-4 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center text-sm font-medium text-warning-foreground"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      You are offline. What you see may be out of date, and changes cannot be saved until you
      reconnect.
    </div>
  );
}
