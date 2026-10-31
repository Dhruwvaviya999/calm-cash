import { defineConfig } from 'vitest/config';

// Unit tests of the process shell (no database, SMTP, or network beyond loopback). The automation
// engine itself is tested against PostgreSQL in the API's integration suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
