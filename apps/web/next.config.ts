import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Vercel Services routes browser requests to the API on this same origin. This also keeps
  // `vercel dev` from baking a standalone localhost API URL from .env.local into the browser.
  ...(process.env.VERCEL === '1' ? { env: { NEXT_PUBLIC_API_URL: '' } } : {}),
  // Dev-tools badge position. The bottom corners would cover the sidebar's collapse control
  // (bottom-left) or the mobile "More" tab (bottom-right); top-left only overlaps the logo link.
  devIndicators: { position: 'top-left' },
  // Compile-time checking of <Link href> and router navigation targets.
  typedRoutes: true,
  // The dashboard is home for now. Temporary (307) so `/` can become a landing or sign-in page.
  redirects() {
    return Promise.resolve([{ source: '/', destination: '/dashboard', permanent: false }]);
  },
  // E-mailed links put a one-time token in the URL of these pages; never leak it in a Referer.
  headers() {
    return Promise.resolve(
      ['/reset-password', '/verify-email'].map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      })),
    );
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
