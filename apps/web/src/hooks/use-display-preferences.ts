import { useSyncExternalStore } from 'react';

import {
  DEFAULT_SIDEBAR_STATE,
  DEFAULT_THEME_PREFERENCE,
  readSidebarState,
  readThemePreference,
  subscribeToPreferences,
  type SidebarState,
  type ThemePreference,
} from '@/lib/preferences';

// The server snapshot is the default; React re-renders with the stored value right after
// hydration, so client-only preferences never cause a hydration mismatch.

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribeToPreferences,
    readThemePreference,
    () => DEFAULT_THEME_PREFERENCE,
  );
}

export function useSidebarState(): SidebarState {
  return useSyncExternalStore(
    subscribeToPreferences,
    readSidebarState,
    () => DEFAULT_SIDEBAR_STATE,
  );
}
