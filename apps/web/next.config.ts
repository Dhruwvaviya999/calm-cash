import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev-tools badge position. The bottom corners would cover the sidebar's collapse control
  // (bottom-left) or the mobile "More" tab (bottom-right); top-left only overlaps the logo link.
  devIndicators: { position: 'top-left' },
  // Compile-time checking of <Link href> and router navigation targets.
  typedRoutes: true,
  // The dashboard is home for now. Temporary (307) so `/` can become a landing or sign-in page.
  redirects() {
    return Promise.resolve([{ source: '/', destination: '/dashboard', permanent: false }]);
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
