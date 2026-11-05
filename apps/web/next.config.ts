import { execSync } from 'node:child_process';

import type { NextConfig } from 'next';

/**
 * The deployed version: the Vercel deployment ID, else `APP_VERSION` (CI, containers), else the
 * commit. The service worker imports it (/sw-version.js) to notice new deployments, so it must
 * differ between deployments.
 */
function appVersion(): string {
  // Unique per Vercel deployment (a redeploy of the same commit is a new version too).
  const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? '';
  if (deployment !== '') return deployment.slice(0, 64);
  const explicit = process.env.APP_VERSION ?? '';
  if (explicit !== '') return explicit.slice(0, 64);
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (commit !== '') return commit.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `build-${Date.now().toString(36)}`;
  }
}

const vercel = process.env.VERCEL === '1';
const development = process.env.NODE_ENV === 'development';
// Browser requests go to the same origin on Vercel; standalone development calls the API origin.
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? '';
const apiOrigin = vercel || configuredApiUrl === '' ? undefined : new URL(configuredApiUrl).origin;

/**
 * Content Security Policy without nonces, so pages stay statically rendered. Next.js and the
 * theme bootstrap use inline scripts, and Radix/Recharts set inline styles, hence 'unsafe-inline'
 * for those two only; everything else is limited to this origin (plus the API origin locally).
 * Receipt previews are `blob:` images; nothing is framed, embedded, or posted elsewhere.
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${apiOrigin === undefined ? '' : ` ${apiOrigin}`}${development ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(vercel ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  // Ignored over plain HTTP (local development); applies once served over HTTPS.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Vercel Services routes browser requests to the API on this same origin. This also keeps
  // `vercel dev` from baking a standalone localhost API URL from .env.local into the browser.
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
    ...(vercel ? { NEXT_PUBLIC_API_URL: '' } : {}),
  },
  // Dev-tools badge position. The bottom corners would cover the sidebar's collapse control
  // (bottom-left) or the mobile "More" tab (bottom-right); top-left only overlaps the logo link.
  devIndicators: { position: 'top-left' },
  // Compile-time checking of <Link href> and router navigation targets.
  typedRoutes: true,
  // The dashboard is home for now. Temporary (307) so `/` can become a landing or sign-in page.
  redirects() {
    return Promise.resolve([{ source: '/', destination: '/dashboard', permanent: false }]);
  },
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: SECURITY_HEADERS },
      // E-mailed links put a one-time token in the URL of these pages; never leak it in a Referer.
      ...['/reset-password', '/verify-email'].map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
      // The service worker and its version file are always re-checked, never served stale.
      ...['/sw.js', '/sw-version.js'].map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      })),
    ]);
  },
  turbopack: {
    rules: {
      // Tailwind CSS v4 runs as a Turbopack loader (no PostCSS config file required).
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
