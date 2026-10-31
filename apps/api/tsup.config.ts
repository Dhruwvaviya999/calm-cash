import { defineConfig } from 'tsup';

// Production build: a single ESM bundle for Node.js. npm dependencies stay external and are
// loaded from node_modules at runtime; the workspace's TypeScript-source shared package and the
// generated Prisma client are compiled into the bundle.
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@calmcash/shared'],
});
