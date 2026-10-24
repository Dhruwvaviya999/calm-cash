import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CalmCash', template: '%s · CalmCash' },
  description: 'CalmCash — a calm, AI-powered personal finance tracker.',
  applicationName: 'CalmCash',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets future mobile/PWA layouts extend under notches using safe-area insets.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9fb' },
    { media: '(prefers-color-scheme: dark)', color: '#16181d' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>): ReactNode {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
