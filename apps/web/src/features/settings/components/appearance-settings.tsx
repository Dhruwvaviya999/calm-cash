'use client';

import type { ChangeEvent, ReactNode } from 'react';

import { THEME_OPTIONS } from '@/components/theme/theme-toggle';
import { useThemePreference } from '@/hooks/use-display-preferences';
import { isThemePreference, setThemePreference } from '@/lib/preferences';

const DESCRIPTIONS = {
  light: 'Warm and bright',
  dark: 'Easy on the eyes at night',
  system: 'Follows your device',
} as const;

/** Theme picker as large radio cards. Changes apply instantly and are saved on this device. */
export function AppearanceSettings(): ReactNode {
  const preference = useThemePreference();

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <label key={value} className="relative">
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (event.target.checked && isThemePreference(event.target.value)) {
                  setThemePreference(event.target.value);
                }
              }}
              className="peer sr-only"
            />
            <span className="flex h-full cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-muted/60 sm:flex-col sm:items-start">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{DESCRIPTIONS[value]}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
