import { defineConfig } from 'vitest/config';

// Unit and in-process HTTP tests: no database, server, or SMTP needed.
// Database-backed suites (`*.integration.test.ts`) run with `pnpm test:integration`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
  },
});
