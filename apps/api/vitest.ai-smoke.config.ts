import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Optional smoke test against a real local Ollama (`pnpm test:ai-smoke`). It is never part of
// `pnpm test` or CI: it needs Ollama running with the configured model pulled, and it sends only
// synthetic, made-up records to that local server — no database and no real financial data.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile); // Only the OLLAMA_* / AI_* variables are read.
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.ai-smoke.test.ts'],
    // Small CPU-only models take a while to load the first time.
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
