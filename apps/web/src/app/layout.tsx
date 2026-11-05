import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { PreferencesScript } from '@/components/theme/preferences-script';
import { PreferencesSync } from '@/components/theme/preferences-sync';
import { AuthProvider } from '@/features/auth';
import { ConnectionStatus, ServiceWorkerManager } from '@/features/pwa';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CalmCash', template: '%s · CalmCash' },
  description: 'CalmCash — a calm, AI-powered personal finance tracker.',
  applicationName: 'CalmCash',
  // Installed on iOS: full-screen launch with the app's own name under the icon.
  appleWebApp: { capable: true, title: 'CalmCash', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Content may extend under notches and gesture bars; the shell pads with safe-area insets.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e12' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>): ReactNode {
  return (
    // The preferences script adjusts <html> (theme class, sidebar state) before hydration.
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <PreferencesScript />
      </head>
      <body>
        <PreferencesSync />
        <ConnectionStatus />
        <ServiceWorkerManager />
        {/* Session state for every route: restored from the API, never from browser storage. */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
