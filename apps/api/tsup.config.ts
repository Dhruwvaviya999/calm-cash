import { defineConfig } from 'tsup';

// Production build: a single ESM bundle for Node.js. npm dependencies stay external and are
// loaded from node_modules at runtime; the workspace's TypeScript-source shared package and the
// generated Prisma client are compiled into the bundle.
// The `.mjs` extension keeps the bundle ESM without a nearby package.json: Vercel deploys the
// contents of `dist/` as the function root, where a `.js` file would be loaded as CommonJS.
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@calmcash/shared'],
});
