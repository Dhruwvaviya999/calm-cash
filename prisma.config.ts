import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

// Prisma 7 does not load `.env` files automatically. Load the repository-root file when it
// exists; variables that are already set (CI, production) are not overwritten.
const envFile = resolve('.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // `prisma generate` works without a connection string. Commands that talk to the database
  // (`migrate`, `studio`, `db`) fail with a clear Prisma error when DATABASE_URL is missing.
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
