import { useSyncExternalStore } from 'react';

// Installation state shared by the whole app. Chromium browsers fire `beforeinstallprompt` once,
// early, when CalmCash can be installed; it is kept here so the Settings entry point can offer the
// browser's own install dialog later. Other browsers (Safari, Firefox) never fire it, and the
// entry point explains their manual steps instead. The browser's own install UI is left in place.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event;
}

export interface InstallState {
  /** The browser offered installation and it can be started from a button. */
  canPrompt: boolean;
  /** CalmCash is running as an installed app (standalone window). */
  standalone: boolean;
  /** Installed during this visit. */
  installed: boolean;
}

const SERVER_STATE: InstallState = { canPrompt: false, standalone: false, installed: false };

let deferred: BeforeInstallPromptEvent | undefined;
let state: InstallState = SERVER_STATE;
const listeners = new Set<() => void>();

function update(next: Partial<InstallState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = 'standalone' in navigator && navigator.standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** Starts listening; call once from the root layout. Returns a cleanup function. */
export function watchInstallability(): () => void {
  update({ standalone: isStandalone() });
  const onPrompt = (event: Event): void => {
    if (!isInstallPromptEvent(event)) return;
    deferred = event;
    update({ canPrompt: true });
  };
  const onInstalled = (): void => {
    deferred = undefined;
    update({ canPrompt: false, installed: true });
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/** Opens the browser's install dialog; the event can be used once, whatever the answer. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (event === undefined) return 'unavailable';
  deferred = undefined;
  update({ canPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
}
