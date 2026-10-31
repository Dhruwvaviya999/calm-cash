# Deploying CalmCash on Vercel

The root `vercel.json` defines one project with two HTTP services and a background daemon.
Keep the Vercel project's Root Directory at the repository root and set its production branch
to `main`. Services and Daemons currently use Vercel's beta deployment features.

## Public routing and application boundaries

| Name     | Kind              | Public requests     | Implementation                                                    |
| -------- | ----------------- | ------------------- | ----------------------------------------------------------------- |
| `api`    | HTTP service      | `/api/*`            | Express; routes already include `/api/v1`                         |
| `web`    | HTTP service      | All remaining paths | Next.js                                                           |
| `worker` | Daemon            | None                | Polls PostgreSQL; sends reminders and notification email          |
| `shared` | Workspace library | None                | Imported and bundled into applications; not deployed as a service |

Vercel preserves the original path when routing to a service, so `/api/v1/health` reaches
Express as `/api/v1/health`. The API rewrite must precede the frontend catch-all.

API requests currently originate in the **browser**, not a Next.js server function. On Vercel,
the frontend uses relative `/api/v1/...` URLs, including receipt uploads and downloads. This
keeps the existing Secure, HttpOnly, SameSite=Strict session cookie on the same origin and works
on preview URLs without compiling a fixed production API hostname into browser code.
`NEXT_PUBLIC_API_URL` is forced to empty by the Next.js configuration when `VERCEL=1`.
Standalone `pnpm dev` continues to use the API origin from `apps/web/.env.local`.

There are **no service bindings** because no server process currently calls another HTTP service.
The API and worker connect directly to PostgreSQL and SMTP; the worker imports the API's automation
code at build time. Those are database connections and module imports, not service-to-service HTTP.
Do not add a `shared` service, a worker HTTP service, or an unused binding to represent these imports.

If a future server function makes an internal API request, declare a binding on its caller:

```json
"bindings": [
  { "type": "service", "service": "api", "format": "url", "env": "API_INTERNAL_URL" }
]
```

Read `process.env.API_INTERNAL_URL` inside that function at request time and preserve the API's
`/api/v1` prefix. Vercel provides this variable; do not define it manually or expose it with a
`NEXT_PUBLIC_` prefix. Bindings are unavailable during builds and in middleware.

## Prerequisites and environment settings

Use Node.js **24.x** and the repository's pinned **pnpm 11.21.0**. The workspace postinstall
generates Prisma Client; the API build also generates it explicitly from the repository root.
Allow builds to access workspace source outside each service's directory.

Provision Neon PostgreSQL, a real SMTP provider with a verified sender, and a **private**
Vercel Blob store. Connect the Blob store to this Vercel project. Keep the database and Blob
stores for previews separate from production. Upload local receipt files to the private store
under `receipts/<first-two-key-characters>/<existing-storage-key>` if migrating existing data;
changing the provider does not migrate files automatically. Existing receipts above 4 MB need
separate migration/download handling before moving them to Vercel Functions.

Set these values in Vercel's environment settings, separately for Production and Preview:

| Variable                                | Value                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                              | `production` for deployed services                                                                       |
| `DATABASE_URL`                          | Neon's pooled PostgreSQL URL (`-pooler` hostname), including the TLS parameters from Neon Console        |
| `DIRECT_URL`                            | Direct URL for the same Neon branch/database (hostname without `-pooler`); used by Prisma CLI/migrations |
| `CORS_ORIGINS`                          | Exact permitted frontend origins, comma-separated; HTTPS, no paths or trailing slashes                   |
| `WEB_APP_URL`                           | Canonical public frontend origin; must appear in `CORS_ORIGINS`                                          |
| `TRUST_PROXY_HOPS`                      | Set for the trusted proxy path; typically `1` behind Vercel; verify client IPs/rate limiting             |
| `RECEIPT_STORAGE_PROVIDER`              | `vercel-blob`                                                                                            |
| `BLOB_READ_WRITE_TOKEN`                 | Server-side token injected by the connected **private** Blob store                                       |
| `EMAIL_DELIVERY_MODE`                   | `smtp`                                                                                                   |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP provider settings; typically port `587` with `false` for STARTTLS, or `465` with `true`             |
| `SMTP_USER`, `SMTP_PASSWORD`            | Provider credentials; set both together                                                                  |
| `EMAIL_FROM`                            | Verified sender, e.g. `CalmCash <no-reply@your-domain.example>`                                          |

Do not upload the development `.env`, local PostgreSQL or Mailpit settings, or `TEST_DATABASE_URL`.
No `NEXT_PUBLIC_API_URL` setting or `RECEIPT_STORAGE_DIR` is needed on Vercel. Blob credentials
stay server-side; files are read only after the API checks session and transaction ownership.
The UI, shared contract, and API enforce the agreed **4 MB** upload limit, below Vercel's
4.5 MB function request/response limit. Historical metadata still accepts the old 10 MB ceiling.

For previews, configure the actual allowed preview origin and use a stable preview domain where
possible. Frontend relative URLs automatically select the current deployment; the API's explicit
origin allowlist and email-link origin must still be configured for that deployment.

## Neon PostgreSQL and Prisma

The repository already uses Prisma 7 with `@prisma/adapter-pg`. Keep this TCP adapter for the
Node.js API and worker; Neon is PostgreSQL and does not require an ORM or schema change.

1. Create a Neon project in a region close to the Vercel API and worker.
2. Open **Connect** for the intended branch, database, and database role. Copy the pooled
   connection string into `DATABASE_URL` in Vercel's environment settings.
3. Turn connection pooling off in the same dialog and copy the direct URL into `DIRECT_URL`.
   Keep the TLS parameters Neon supplies on both URLs. They must reach the same database.
4. Set these URLs for Production and use separate Neon branches/databases for Preview and local
   development. To use Neon locally, replace the URLs in the root `.env`; the browser needs neither.

For example, with placeholder credentials:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@ep-YOUR-ENDPOINT-pooler.REGION.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@ep-YOUR-ENDPOINT.REGION.aws.neon.tech/neondb?sslmode=require"
```

The API and worker use `DATABASE_URL`. Prisma CLI uses `DIRECT_URL`, then the Neon integration's
`DATABASE_URL_UNPOOLED` if present, then `DATABASE_URL` for local setups. Empty values are skipped.
With the Neon/Vercel integration, its injected `DATABASE_URL_UNPOOLED` can supply the direct URL
without setting `DIRECT_URL` yourself. Keep the URLs server-side, without a `NEXT_PUBLIC_` prefix.

After configuring the intended database, run these commands from the repository root:

```sh
pnpm db:generate
pnpm db:deploy
```

Use the checked-in migrations rather than `prisma db push`: the migrations also contain custom
PostgreSQL constraints. `migrate dev` is for an isolated development database; production uses
`migrate deploy`. Changing a connection string does not copy data from the old local database.
No Neon project is provisioned and no remote migrations are run merely by editing this configuration.

Integration tests retain their dedicated `TEST_DATABASE_URL`; their migration subprocess overrides
all three CLI URL variables so an inherited production direct URL cannot take precedence.

See [Prisma connection management](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections)
and [Neon's Prisma guide](https://neon.com/docs/guides/prisma).

## Worker

`Dockerfile.worker` uses the repository root as its Docker build context so pnpm can resolve
the API and shared workspace packages. `.dockerignore` excludes local credentials and data.
It bundles the worker for Node.js 24 and starts it as a non-root user. The internal health
endpoint is on port 8080; it is used by the daemon liveness probe and has no public rewrite.

The proposed configuration starts **one 1 GiB instance in `iad1`**. Confirm that region against
your database location before deployment. A continuously running daemon consumes memory quota
even while idle. Daemons currently run in **production only**, so preview deployments do not
start a separate worker. Run `pnpm dev:worker` with isolated development resources to test it.
API email work is registered with `waitUntil` so Vercel can finish it after an HTTP response.
This is bounded background execution; the continuous automation loop belongs in the daemon.

## Validation and deployment

Run the normal checks first:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker build -f Dockerfile.worker -t calmcash-worker:vercel-check .
```

With Vercel CLI installed and the project linked to your account, test the combined local router:

```sh
vercel dev
```

Use local PostgreSQL and Mailpit for local testing. Check the URL printed by the CLI for
`/api/v1/health`, `/api/v1/health/ready`, registration, verification, login after refresh,
CSRF-protected writes, and private receipt upload/download/delete. `PORT` assigned by Vercel
takes precedence over standalone `API_PORT`. Test the worker separately as described above.
Linking to an account and an authenticated Vercel build are required to validate platform routing
and runtime behavior; local unit tests and application builds do not replace those checks.

Before the first production deployment, configure production `DATABASE_URL` and `DIRECT_URL` and apply migrations
from the repository root with `pnpm db:deploy`. Use a controlled release step for later migrations;
service builds do not automatically migrate a database. Import the Git repository, confirm the
root and production branch settings, add environment values, and deploy after configuration review.

References: [Services](https://vercel.com/docs/services),
[service routing](https://vercel.com/docs/services/routing),
[bindings](https://vercel.com/docs/services/bindings),
[Daemons](https://vercel.com/docs/daemons),
[private Blob storage](https://vercel.com/docs/vercel-blob/private-storage).
