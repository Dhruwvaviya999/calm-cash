import type { MetadataRoute } from 'next';

/**
 * Web app manifest (served at /manifest.webmanifest). Colours match the light theme's paper
 * background, so the splash screen and title bar blend with the first paint. Icons come from the
 * CalmCash mark (see scripts/generate-app-icons.mjs).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CalmCash',
    short_name: 'CalmCash',
    description:
      'A calm, private personal finance tracker: accounts, transactions, budgets, recurring payments, and insights.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    // Phones stay in portrait by habit, but tablets and desktops may rotate or resize freely.
    orientation: 'any',
    background_color: '#fbfaf7',
    theme_color: '#fbfaf7',
    lang: 'en',
    dir: 'ltr',
    categories: ['finance', 'productivity'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
