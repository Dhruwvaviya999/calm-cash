import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsup';

// Production build: a single ESM bundle for Node.js. npm dependencies stay external and are
// loaded from node_modules at runtime; the workspace's TypeScript-source shared package and the
// generated Prisma client are compiled into the bundle.
//
// `dist/` also gets its own `package.json` declaring `"type": "module"`. Node decides whether a
// `.js` file is ESM from the nearest `package.json`; hosts that deploy `dist/` on its own (Vercel's
// Express service runs the bundle as `/var/task/server.js`) no longer see `apps/api/package.json`
// and would otherwise load the bundle as CommonJS ("Cannot use import statement outside a module").
const distPackageJson = fileURLToPath(new URL('dist/package.json', import.meta.url));

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
  onSuccess: async () => {
    await writeFile(distPackageJson, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  },
});
