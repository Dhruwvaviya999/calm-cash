import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror the `@/*` path alias from tsconfig.json.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Most components are tested by rendering them to static HTML with react-dom/server in Node.
    // Interactive tests (forms, route guards) opt into a DOM with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/testing/setup.ts'],
    env: { NEXT_PUBLIC_API_URL: 'http://api.test' },
  },
});
