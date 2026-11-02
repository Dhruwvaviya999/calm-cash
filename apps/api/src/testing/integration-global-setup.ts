import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { assertDisposableDatabaseUrl } from './disposable-database';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Brings the dedicated test database up to date with `prisma migrate deploy` (which also creates
 * it when missing). It never resets anything; tests truncate tables themselves.
 */
export default function setup(): void {
  const testDatabaseUrl = assertDisposableDatabaseUrl(
    process.env.TEST_DATABASE_URL,
    process.env.DATABASE_URL,
  );
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: repositoryRoot,
    // Override every CLI URL source: an inherited Neon production direct URL must never win.
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
      DATABASE_URL_UNPOOLED: testDatabaseUrl,
    },
    stdio: 'pipe',
  });
}
