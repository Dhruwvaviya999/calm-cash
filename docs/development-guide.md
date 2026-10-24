# CalmCash development guide

Everything needed to set up, run, test, and troubleshoot CalmCash locally.

## 1. Prerequisites

| Tool                    | Version                           | Notes                                                                           |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Node.js                 | **24 LTS** (≥ 24.11)              | `.nvmrc` pins the major version (`nvm use`).                                    |
| pnpm                    | **11.x**                          | `corepack enable` uses the version pinned in `package.json` (`packageManager`). |
| Docker + Docker Compose | Docker Engine 24+ with Compose v2 | Docker Desktop on Windows/macOS. Only needed for the local database.            |
| Git                     | any recent version                |                                                                                 |

PostgreSQL itself does **not** need to be installed — it runs in a container. A `psql` client is
optional (you can use the one inside the container, see §4). If you prefer an existing PostgreSQL
server, point `DATABASE_URL` at it and skip the Docker steps.

Verify the tools:

```bash
node --version            # v24.x
pnpm --version            # 11.x
docker --version
docker compose version    # v2.x or later
```

## 2. First-time setup

```bash
# 1. Install dependencies (also generates the Prisma Client via the root `postinstall`)
pnpm install

# 2. Create local environment files from the templates
cp .env.example .env                              # backend + database
cp apps/web/.env.example apps/web/.env.local      # web app
#   (PowerShell: Copy-Item .env.example .env; Copy-Item apps/web/.env.example apps/web/.env.local)

# 3. Start PostgreSQL and wait until it is healthy
pnpm db:up

# 4. Apply all migrations
pnpm db:migrate

# 5. Start the API and the web app together
pnpm dev
```

Then open:

- Web app: <http://localhost:3000> — the "System status" card should report the API as **Online**
  and the database as **Connected**.
- API liveness: <http://localhost:4000/api/v1/health>
- API readiness: <http://localhost:4000/api/v1/health/ready>

The placeholder values in `.env.example` work as-is for local development. Change
`POSTGRES_PASSWORD` and update the password inside `DATABASE_URL` to match if you prefer.

## 3. Everyday commands

All commands run from the repository root.

| Command             | What it does                                                                      |
| ------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev`          | Runs the API (`:4000`, restarts on change) and the web app (`:3000`, hot reload). |
| `pnpm build`        | Production builds: `apps/api/dist/server.js` (tsup) and `apps/web/.next` (Next).  |
| `pnpm lint`         | ESLint across the workspace; warnings fail the run.                               |
| `pnpm typecheck`    | `tsc` for root tooling, the shared package, the API, and the web app.             |
| `pnpm test`         | Vitest suites of all packages.                                                    |
| `pnpm format`       | Formats all files with Prettier.                                                  |
| `pnpm format:check` | Verifies formatting without writing (use in CI).                                  |

Run a script for one package with `--filter`:

```bash
pnpm --filter @calmcash/api dev          # API only
pnpm --filter @calmcash/web dev          # web only
pnpm --filter @calmcash/shared test      # shared tests only
pnpm --filter @calmcash/api typecheck    # API type-check only
```

Run the production builds locally:

```bash
pnpm build
pnpm --filter @calmcash/api start        # node dist/server.js (reads the root .env)
pnpm --filter @calmcash/web start        # next start on :3000
```

## 4. Database

| Command            | What it does                                                                           |
| ------------------ | -------------------------------------------------------------------------------------- |
| `pnpm db:up`       | Starts the PostgreSQL 18 container and waits for its health check.                     |
| `pnpm db:down`     | Stops and removes the container. Data persists in the `calmcash_postgres-data` volume. |
| `pnpm db:generate` | Regenerates the Prisma Client into `apps/api/src/generated/prisma` (git-ignored).      |
| `pnpm db:migrate`  | `prisma migrate dev`: applies pending migrations; with schema changes, creates one.    |
| `pnpm db:deploy`   | `prisma migrate deploy`: applies pending migrations only (CI/production).              |
| `pnpm db:studio`   | Opens Prisma Studio to browse and edit data.                                           |

Common workflows:

```bash
# Create a migration after editing prisma/schema.prisma
pnpm db:migrate --name add_account_archiving

# Create a migration you want to edit first (e.g. to add CHECK constraints)
pnpm exec prisma migrate dev --create-only --name add_some_constraint
#   …edit prisma/migrations/<timestamp>_add_some_constraint/migration.sql, then:
pnpm db:migrate

# Show which migrations are applied
pnpm exec prisma migrate status

# Open psql inside the container
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Drop and recreate the database, then re-apply every migration (destroys local data)
pnpm exec prisma migrate reset

# Remove the container and its data volume entirely (destroys local data)
docker compose down --volumes
```

Prisma 7 does not regenerate the client automatically after migrations. Run `pnpm db:generate`
after changing `schema.prisma` (`pnpm install` also runs it).

## 5. Testing

Tests use [Vitest](https://vitest.dev) in every package and
[Supertest](https://github.com/ladjs/supertest) for in-process HTTP tests of the API. No running
database or server is needed: API tests build the app with `createApp()` and stub the
database health check.

```bash
pnpm test                                        # everything
pnpm --filter @calmcash/api test                 # one package
pnpm --filter @calmcash/api exec vitest          # watch mode
pnpm --filter @calmcash/api exec vitest src/app.test.ts   # one file
```

| Package  | Suites                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared` | Minor-unit money helpers; schema validation rules; compile-time schema ⇄ interface equality.                                                                               |
| `api`    | Health endpoints, error envelopes, CORS, security headers, request IDs, env validation, the validation convention, graceful shutdown, Prisma enum ⇄ shared literal parity. |
| `web`    | API client: URL building, payload validation, error mapping, network failures, aborts.                                                                                     |

Type-level assertions (`expectTypeOf`) are checked by `pnpm typecheck`, not by `pnpm test`.

**Before pushing**, run the same gates CI should run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## 6. Conventions

- **TypeScript only.** Application code is `.ts`/`.tsx`. `strict` and the extra flags in
  `tsconfig.base.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …) apply to
  every package. Only tooling configuration that cannot be TypeScript (`eslint.config.mjs`) is
  JavaScript.
- **No `any`, no unchecked casts.** ESLint enforces `no-explicit-any`, bans `@ts-ignore` and
  `@ts-nocheck`, requires a description for `@ts-expect-error`, and forbids type assertions
  (`as const` is allowed). Use `unknown` plus a type guard or a Zod schema for untrusted data.
- **Explicit types at boundaries.** Exported functions declare parameter and return types.
- **Validate at the edges.** HTTP input via `validateRequest`; HTTP responses in the web client via
  the shared schemas; environment variables at startup.
- **Money:** `bigint` minor units in code, decimal strings in JSON, never `number`. See
  [database-design.md](./database-design.md#2-monetary-representation).
- **File names:** `kebab-case`. API module files are `<feature>.<role>.ts`. Tests sit next to the
  code as `*.test.ts`.
- **Imports:** in the web app use `@/…` for `src/`; import shared code only from
  `@calmcash/shared`; never import another feature's or module's internals.

## 7. Troubleshooting

**`pnpm db:up` fails with "ports are not available … 5432" or "address already in use"**
Another PostgreSQL is using that port. The template already publishes the container on **5433**.
If 5433 is taken too, change `POSTGRES_PORT` in `.env` _and_ the port in `DATABASE_URL`, then run
`pnpm db:up` again.

**`Cannot connect to the Docker daemon` / `failed to connect to the docker API`**
Start Docker Desktop (or the Docker service) and wait until it reports that it is running.

**The API exits with `Invalid environment configuration`**
The message lists each offending variable by name (values are never printed). Make sure
`.env` exists in the repository root and compare it with `.env.example`.

**The web app fails with `Invalid public environment configuration`**
Create `apps/web/.env.local` from `apps/web/.env.example`. `NEXT_PUBLIC_API_URL` must be an
origin such as `http://localhost:4000` (no `/api/v1`). Restart `pnpm dev` after changing it.

**The status card shows "API: Offline"**
The API is not running or not reachable at `NEXT_PUBLIC_API_URL`. Check the `apps/api dev:` lines
of `pnpm dev`. If the API is up, check that `CORS_ORIGINS` contains the exact origin of the web app
(scheme, host, and port, with no trailing slash).

**The status card shows "Database: Unavailable"**
The API cannot reach PostgreSQL. Run `pnpm db:up` and check `DATABASE_URL`. The API reconnects
automatically, with no restart needed.

**`Cannot find module '../generated/prisma/client'` or missing Prisma types**
Run `pnpm db:generate`.

**`datasource.url property is required` from a Prisma command**
`DATABASE_URL` is not set. Create `.env` from `.env.example`, or export the variable.

**`EADDRINUSE: address already in use :::4000` (or `:3000`)**
An old dev server is still running. Stop it, or find the process:
`netstat -ano | findstr :4000` then `taskkill /PID <pid> /F` on Windows, or
`lsof -i :4000` then `kill <pid>` on macOS/Linux.

**`pnpm install` warns about ignored build scripts**
pnpm 11 blocks dependency install scripts unless they are listed under `allowBuilds` in
`pnpm-workspace.yaml`. Add the package there only if you trust it.

**`pnpm format:check` reports files on Windows**
Line endings are normalised to LF by `.gitattributes` and `.editorconfig`. Run `pnpm format`. If the
files were checked out with CRLF before `.gitattributes` existed, re-checkout them.

**Vitest fails with `ERR_PACKAGE_IMPORT_NOT_DEFINED` (e.g. `#module-evaluator`) on Windows**
The clone sits in a directory that is too deep. pnpm's store paths under `node_modules/.pnpm`
then exceed 260 characters, which Node.js cannot read even when Windows long paths are enabled.
Clone into a shorter path (for example `C:\dev\calmcash`) and run `pnpm install` again.

**The first `pnpm lint` is slow**
Type-aware linting builds TypeScript programs on its first run, and antivirus scanning of a fresh
`node_modules` adds to that. Later runs are much faster.

**`next dev` creates or updates `apps/web/AGENTS.md`**
Next.js writes version-matched hints for AI coding agents there. The file is committed on purpose;
set `agentRules: false` in `next.config.ts` to disable it.

**Upgrade notices for Prisma 8 or TypeScript 7**
Do not upgrade blindly. Prisma 8 is a release candidate, and TypeScript 7 is not yet supported by
`typescript-eslint`. Version decisions are recorded in [architecture.md](./architecture.md#11-technology-decisions).

**Production installs**
`pnpm install --prod` skips the Prisma CLI, which the root `postinstall` hook needs. In
deployment images, build with dev dependencies installed, or install with `--ignore-scripts`.
The API bundle already contains the generated client.
