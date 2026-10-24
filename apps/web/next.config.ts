import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Compile-time checking of <Link href> and router navigation targets.
  typedRoutes: true,
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
