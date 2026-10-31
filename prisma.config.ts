import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

// Prisma 7 does not load `.env` files automatically. Load the repository-root file when it
// exists; variables that are already set (CI, production) are not overwritten.
const envFile = resolve('.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Runtime clients use DATABASE_URL (Neon's pooled endpoint). Prisma CLI commands use the
// direct endpoint; DATABASE_URL_UNPOOLED is provided by the Neon/Vercel integration.
// A local PostgreSQL setup can keep using DATABASE_URL alone.
const databaseUrl = [
  process.env.DIRECT_URL,
  process.env.DATABASE_URL_UNPOOLED,
  process.env.DATABASE_URL,
]
  .map((value) => value?.trim())
  .find((value) => value !== undefined && value !== '');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // `prisma generate` works without a connection string. Commands that talk to the database
  // (`migrate`, `studio`, `db`) fail with a clear Prisma error when no connection URL is set.
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
