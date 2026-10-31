import { defineConfig } from 'tsup';

// Production build: one ESM bundle for Node.js, like the API's. The worker's engine lives in the
// API package (`@calmcash/api/automation`, TypeScript source) together with the domain services it
// reuses; it is compiled into this bundle along with the shared package and the generated Prisma
// client. npm dependencies stay external and are loaded from node_modules at runtime.
export default defineConfig({
  entry: ['src/main.ts', 'src/cli.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@calmcash/shared', '@calmcash/api'],
});
