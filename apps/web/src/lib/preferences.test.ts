import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  parseSidebarState,
  parseThemePreference,
  PREFERENCES_BOOTSTRAP_SCRIPT,
  resolveTheme,
  SIDEBAR_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from './preferences';

describe('preference parsing', () => {
  it('falls back to defaults for missing or unknown values', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseSidebarState(null)).toBe('expanded');
    expect(parseSidebarState('collapsed')).toBe('collapsed');
  });

  it('resolves the system preference from the operating system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

interface BootstrapResult {
  dark: boolean;
  sidebar: string | null;
}

/** Runs the real pre-paint script against minimal fakes of the browser globals it uses. */
function runBootstrap(stored: Record<string, string>, systemDark: boolean): BootstrapResult {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const documentElement = {
    classList: {
      toggle: (name: string, force: boolean): void => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name: string, value: string): void => {
      attributes.set(name, value);
    },
  };

  runInNewContext(PREFERENCES_BOOTSTRAP_SCRIPT, {
    document: { documentElement },
    localStorage: { getItem: (key: string): string | null => stored[key] ?? null },
    window: { matchMedia: (): { matches: boolean } => ({ matches: systemDark }) },
  });

  return { dark: classes.has('dark'), sidebar: attributes.get('data-sidebar') ?? null };
}

describe('PREFERENCES_BOOTSTRAP_SCRIPT', () => {
  it('applies the same theme rules as resolveTheme', () => {
    expect(runBootstrap({}, true).dark).toBe(true);
    expect(runBootstrap({}, false).dark).toBe(false);
    expect(runBootstrap({ [THEME_STORAGE_KEY]: 'light' }, true).dark).toBe(false);
    expect(runBootstrap({ [THEME_STORAGE_KEY]: 'dark' }, false).dark).toBe(true);
  });

  it('restores a collapsed sidebar before first paint', () => {
    expect(runBootstrap({ [SIDEBAR_STORAGE_KEY]: 'collapsed' }, false).sidebar).toBe('collapsed');
    expect(runBootstrap({}, false).sidebar).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    expect(() => {
      runInNewContext(PREFERENCES_BOOTSTRAP_SCRIPT, {
        document: { documentElement: {} },
        localStorage: {
          getItem: (): never => {
            throw new Error('SecurityError');
          },
        },
        window: {},
      });
    }).not.toThrow();
  });
});
