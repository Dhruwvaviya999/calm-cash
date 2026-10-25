import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror the `@/*` path alias from tsconfig.json.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Components are tested by rendering them to static HTML with react-dom/server, so no DOM
    // emulation (and no extra test dependencies) is needed.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
