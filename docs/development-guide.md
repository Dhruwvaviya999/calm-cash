# CalmCash development guide

Everything needed to set up, run, test, and troubleshoot CalmCash locally.

## 1. Prerequisites

| Tool                    | Version                           | Notes                                                                           |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Node.js                 | **24 LTS** (≥ 24.11)              | `.nvmrc` pins the major version (`nvm use`).                                    |
| pnpm                    | **11.x**                          | `corepack enable` uses the version pinned in `package.json` (`packageManager`). |
| Docker + Docker Compose | Docker Engine 24+ with Compose v2 | Docker Desktop on Windows/macOS. For the local database and e-mail catcher.     |
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

# 3. Start PostgreSQL and the Mailpit e-mail catcher, and wait until they are healthy
pnpm db:up
pnpm mail:up

# 4. Apply all migrations
pnpm db:migrate

# 5. Start the API and the web app together
pnpm dev
```

Then open:

- Web app: <http://localhost:3000>. Signed-out visitors are sent to **Sign in**. Create an account
  at `/register`, then confirm it from the inbox below and sign in. In **Settings → About and
  diagnostics**, the "System status" card should report the API as **Online** and the database as
  **Connected**.
- E-mail inbox (Mailpit): <http://localhost:8025> — confirmation and password-reset messages land
  here; nothing leaves your machine.
- API liveness: <http://localhost:4000/api/v1/health>
- API readiness: <http://localhost:4000/api/v1/health/ready>

The placeholder values in `.env.example` work as-is for local development. Change
`POSTGRES_PASSWORD` and update the password inside `DATABASE_URL` to match if you prefer.

## 3. Everyday commands

All commands run from the repository root.

| Command                 | What it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev`              | Runs the API (`:4000`, restarts on change) and the web app (`:3000`, hot reload). |
| `pnpm build`            | Production builds: `apps/api/dist/server.js` (tsup) and `apps/web/.next` (Next).  |
| `pnpm lint`             | ESLint across the workspace; warnings fail the run.                               |
| `pnpm typecheck`        | `tsc` for root tooling, the shared package, the API, and the web app.             |
| `pnpm test`             | Vitest suites of all packages (no database needed).                               |
| `pnpm test:integration` | API integration tests against the `TEST_DATABASE_URL` database.                   |
| `pnpm format`           | Formats all files with Prettier.                                                  |
| `pnpm format:check`     | Verifies formatting without writing (use in CI).                                  |

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

| Command            | What it does                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `pnpm db:up`       | Starts the PostgreSQL 18 container and waits for its health check.                      |
| `pnpm mail:up`     | Starts Mailpit (SMTP on `127.0.0.1:1025`, inbox on <http://localhost:8025>).            |
| `pnpm db:down`     | Stops and removes the containers. Data persists in the `calmcash_postgres-data` volume. |
| `pnpm db:generate` | Regenerates the Prisma Client into `apps/api/src/generated/prisma` (git-ignored).       |
| `pnpm db:migrate`  | `prisma migrate dev`: applies pending migrations; with schema changes, creates one.     |
| `pnpm db:deploy`   | `prisma migrate deploy`: applies pending migrations only (CI/production).               |
| `pnpm db:studio`   | Opens Prisma Studio to browse and edit data.                                            |

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
[Supertest](https://github.com/ladjs/supertest) for in-process HTTP tests of the API. `pnpm test`
needs no running database or server: API tests build the app with `createApp()` and stub the
database health check. Database-backed flows (authentication end to end) live in
`*.integration.test.ts` files and run with `pnpm test:integration`.

```bash
pnpm test                                        # everything
pnpm --filter @calmcash/api test                 # one package
pnpm --filter @calmcash/api exec vitest          # watch mode
pnpm --filter @calmcash/api exec vitest src/app.test.ts   # one file
pnpm test:integration                            # API against a real database (see below)
```

**Integration tests** use `TEST_DATABASE_URL` from the root `.env` (template in `.env.example`). It
must name a database ending in `_test` and differ from `DATABASE_URL`; the suite refuses to run
otherwise. The database is created and migrated automatically (`prisma migrate deploy`) on the same
PostgreSQL server, and every table is truncated before each test — the development database is
never touched. Run `pnpm db:up` first. Integration files run one at a time; the transaction
concurrency suite sends parallel requests that each use their own pooled connection, so they
exercise PostgreSQL's row locks for real. Integration tests use an in-memory e-mail service and
never send mail.

**Running a second API by hand** (for example against the test database for a browser check):
override `DATABASE_URL`, `API_PORT`, `CORS_ORIGINS`, and the `SMTP_*` variables (`SMTP_HOST=localhost`,
`SMTP_PORT=1025`, empty `SMTP_USER`/`SMTP_PASSWORD`) explicitly, because it otherwise inherits the
root `.env`, including any real mail server configured there.

| Package  | Suites                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared` | Minor-unit money helpers; schema validation rules; compile-time schema ⇄ interface equality. Auth input/response schemas and the password policy. Transaction, reconciliation, bulk, and list-query schemas; tags; amount filters; time-zone conversion including daylight-saving gaps and overlaps.                                                                                                                                                         |
| `api`    | Health endpoints, error envelopes, CORS, origin check, rate limiting, security headers, request IDs, env validation, the validation convention, graceful shutdown, Prisma enum ⇄ shared literal parity, token/cookie/Argon2/user-agent helpers, e-mail templates, balance arithmetic, transaction rules and filters, category ordering. Integration: authentication, accounts, transactions (incl. concurrency and failure injection), categories, and tags. |
| `web`    | API client (credentials, CSRF header and retry); safe return paths; money/date formatting; navigation rules; the theme bootstrap script; budget status; fixtures against shared schemas; static rendering of finance components; transaction form and URL-filter models; in jsdom: auth forms, route guards, auth provider, user menu, settings, mobile navigation, theme, accounts, and the transactions page.                                              |

Type-level assertions (`expectTypeOf`) are checked by `pnpm typecheck`, not by `pnpm test`.

Web component tests render to static HTML with `react-dom/server` in Vitest's Node environment.
Interactive tests (forms, guards, menus) opt into jsdom with a `// @vitest-environment jsdom` first
line and use Testing Library; `src/testing/auth.tsx` builds auth context values. Name them
`*.test.tsx`.

**Checking the UI by hand.** Use your browser's device toolbar at 320, 375, 430, 768, 1024, and
1440px, in light and dark themes (Settings → Appearance or the header theme menu). Phones should
show the bottom bar, tablets the icon rail, and desktops the collapsible sidebar, with no
horizontal scrolling at any width.

**Before pushing**, run the same gates CI should run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
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
- **UI:** use design tokens (`bg-card`, `text-muted-foreground`, `text-income`, …), never raw
  colours; build on the components in `components/`; keep Server Components the default; label
  sample data. Details, including how to add shadcn/ui primitives, are in
  [ui-architecture.md](./ui-architecture.md).

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

**The status card (Settings) shows "API: Offline"**
The API is not running or not reachable at `NEXT_PUBLIC_API_URL`. Check the `apps/api dev:` lines
of `pnpm dev`. If the API is up, check that `CORS_ORIGINS` contains the exact origin of the web app
(scheme, host, and port, with no trailing slash). The rest of the app keeps working without the API.

**Registration answers "We could not send the email right now" (503 `EMAIL_DELIVERY_FAILED`)**
The API cannot reach the SMTP server. Run `pnpm mail:up` (the API logs "SMTP server is not
reachable" at startup when it is down) or check the `SMTP_*` variables, then request a new link
from the sign-in or confirmation page.

**Signing in works but you are immediately signed out again**
The session cookie is `SameSite=Strict` and host-only. Open the web app on the same host name as the
API in `NEXT_PUBLIC_API_URL` (`localhost` for both, not `localhost` + `127.0.0.1`), and make sure
`CORS_ORIGINS` contains the exact web origin.

**Requests fail with `ORIGIN_NOT_ALLOWED` or `CSRF_TOKEN_INVALID`**
`ORIGIN_NOT_ALLOWED`: the web origin is missing from `CORS_ORIGINS`. `CSRF_TOKEN_INVALID` from a tool
such as curl: send the `csrfToken` from the login or `/auth/me` response as `x-csrf-token`.

**`pnpm test:integration` refuses to start**
Set `TEST_DATABASE_URL` in `.env` to a database whose name ends in `_test` (see `.env.example`) and
start PostgreSQL with `pnpm db:up`.

**`pnpm db:up` or `pnpm mail:up` fails because a port is already allocated**
Another container or program uses 5433, 1025, or 8025. Change `POSTGRES_PORT` (plus the port in
`DATABASE_URL` and `TEST_DATABASE_URL`) or `MAILPIT_SMTP_PORT`/`MAILPIT_UI_PORT` (plus `SMTP_PORT`)
in `.env`.

**`pnpm typecheck` fails in `.next/dev/types/validator.ts` after deleting or renaming a page**
Those route types were generated by an earlier `next dev` run. Delete `apps/web/.next/dev` (or
start `pnpm dev` once to regenerate it) and run the type-check again.

**A round "N" badge covers the logo in development**
That is the Next.js dev-tools indicator. It is placed top-left on purpose (`devIndicators` in
`next.config.ts`), because the bottom corners would cover the sidebar's collapse control or the
mobile "More" tab. It does not appear in production builds.

**The status card (Settings) shows "Database: Unavailable"**
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
