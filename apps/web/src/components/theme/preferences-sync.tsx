'use client';

import { useEffect } from 'react';

import {
  applyThemePreference,
  readThemePreference,
  subscribeToPreferences,
} from '@/lib/preferences';

/** Keeps the theme in sync with OS-level light/dark changes and with other open tabs. */
export function PreferencesSync(): null {
  useEffect(
    () =>
      subscribeToPreferences(() => {
        applyThemePreference(readThemePreference());
      }),
    [],
  );
  return null;
}
