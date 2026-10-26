import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Integration tests talk to a real PostgreSQL database, which is wiped between tests. They only
// ever use TEST_DATABASE_URL, which must name a dedicated `*_test` database — never the
// development database in DATABASE_URL (enforced by src/testing/integration-global-setup.ts).
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile); // Variables already set in the environment win.
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./src/testing/integration-global-setup.ts'],
    // Suites share one database, so they run one file at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
