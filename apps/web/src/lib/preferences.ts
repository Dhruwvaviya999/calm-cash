// Display preferences (theme, sidebar) stored in localStorage and mirrored on <html>.
//
// The same keys and rules are used by PREFERENCES_BOOTSTRAP_SCRIPT, which runs before first
// paint, so server-rendered (statically prerendered) pages show the right theme without a flash.
// Everything that touches `window` is only called from event handlers or effects.

export const THEME_STORAGE_KEY = 'calmcash:theme';
export const SIDEBAR_STORAGE_KEY = 'calmcash:sidebar';
const PREFERENCES_CHANGE_EVENT = 'calmcash:preferences-change';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';
export type SidebarState = 'expanded' | 'collapsed';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const DEFAULT_SIDEBAR_STATE: SidebarState = 'expanded';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function parseThemePreference(value: string | null): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function parseSidebarState(value: string | null): SidebarState {
  return value === 'collapsed' ? 'collapsed' : 'expanded';
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

/**
 * Inline script for <head>: applies the stored theme and sidebar state to <html> before the
 * browser paints. Kept dependency-free and wrapped in try/catch for blocked storage.
 */
export const PREFERENCES_BOOTSTRAP_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage,t=s.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var k=t==="dark"||(t!=="light"&&window.matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches);d.classList.toggle("dark",k);if(s.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==="collapsed"){d.setAttribute("data-sidebar","collapsed")}}catch(e){}})();`;

// --- Browser-only helpers -------------------------------------------------------------------

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the change still applies.
  }
}

function notifyPreferenceChange(): void {
  window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

/** Switches colours instantly instead of animating every transition on the page. */
function withoutTransitions(apply: () => void): void {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  apply();
  document.body.getBoundingClientRect(); // Force a style recalculation before re-enabling.
  window.setTimeout(() => {
    style.remove();
  }, 0);
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(readStorage(THEME_STORAGE_KEY));
}

export function applyThemePreference(preference: ThemePreference): void {
  const dark = resolveTheme(preference, systemPrefersDark()) === 'dark';
  const root = document.documentElement;
  if (root.classList.contains('dark') !== dark) {
    withoutTransitions(() => {
      root.classList.toggle('dark', dark);
    });
  }
}

export function setThemePreference(preference: ThemePreference): void {
  writeStorage(THEME_STORAGE_KEY, preference === DEFAULT_THEME_PREFERENCE ? null : preference);
  applyThemePreference(preference);
  notifyPreferenceChange();
}

export function readSidebarState(): SidebarState {
  return document.documentElement.getAttribute('data-sidebar') === 'collapsed'
    ? 'collapsed'
    : 'expanded';
}

export function applySidebarState(state: SidebarState): void {
  if (state === 'collapsed') {
    document.documentElement.setAttribute('data-sidebar', 'collapsed');
  } else {
    document.documentElement.removeAttribute('data-sidebar');
  }
}

export function setSidebarState(state: SidebarState): void {
  writeStorage(SIDEBAR_STORAGE_KEY, state === DEFAULT_SIDEBAR_STATE ? null : state);
  applySidebarState(state);
  notifyPreferenceChange();
}

/** Restores the default theme and sidebar state, removing anything stored. */
export function resetDisplayPreferences(): void {
  writeStorage(THEME_STORAGE_KEY, null);
  writeStorage(SIDEBAR_STORAGE_KEY, null);
  applyThemePreference(DEFAULT_THEME_PREFERENCE);
  applySidebarState(DEFAULT_SIDEBAR_STATE);
  notifyPreferenceChange();
}

/**
 * Calls `onChange` when preferences change in this tab, in another tab (storage event), or when
 * the operating system switches between light and dark. Returns an unsubscribe function.
 */
export function subscribeToPreferences(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  const handleStorage = (event: StorageEvent): void => {
    if (
      event.key === null ||
      event.key === THEME_STORAGE_KEY ||
      event.key === SIDEBAR_STORAGE_KEY
    ) {
      applyThemePreference(readThemePreference());
      applySidebarState(parseSidebarState(readStorage(SIDEBAR_STORAGE_KEY)));
      onChange();
    }
  };

  window.addEventListener(PREFERENCES_CHANGE_EVENT, onChange);
  window.addEventListener('storage', handleStorage);
  media.addEventListener('change', onChange);

  return () => {
    window.removeEventListener(PREFERENCES_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', handleStorage);
    media.removeEventListener('change', onChange);
  };
}
