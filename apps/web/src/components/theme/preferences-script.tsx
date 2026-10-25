import type { ReactNode } from 'react';

import { PREFERENCES_BOOTSTRAP_SCRIPT } from '@/lib/preferences';

/**
 * Rendered in the root layout's <head>: applies the saved theme and sidebar state before the
 * first paint, so statically rendered pages never flash the wrong theme. <html> carries
 * `suppressHydrationWarning` because this script changes its attributes before React hydrates.
 */
export function PreferencesScript(): ReactNode {
  return <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOTSTRAP_SCRIPT }} />;
}
