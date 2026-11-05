# Environment variables

Every value is validated at start-up (Zod: `apps/api/src/config/*.ts`, `apps/web/src/lib/env.ts`).
A process with an invalid configuration refuses to start and names the variable and the rule —
never the value. Templates with placeholders only: [`.env.example`](../../.env.example) (API,
worker, database, local services) and [`apps/web/.env.example`](../../apps/web/.env.example).
Real `.env` / `.env.local` files are ignored by Git and Docker builds.

**Secret** = must only live in the deployment platform's secret store (never in Git, images,
logs, tickets, or a `NEXT_PUBLIC_` variable). Components: **A** API, **W** worker, **B** web
build (inlined into the browser bundle), **P** Prisma CLI / migration job.

## Core

| Variable                                              | Comp. | Req.             | Development behaviour        | Production requirement                                                               | Secret |
| ----------------------------------------------------- | ----- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------------ | ------ |
| `NODE_ENV`                                            | A W   | yes on hosts     | `development` default        | `production` (secure cookies, `__Host-` prefix, HTTPS origins, explicit e-mail mode) | no     |
| `DATABASE_URL`                                        | A W P | yes              | local Docker PostgreSQL      | Neon **pooled** URL (`-pooler` host) with TLS parameters                             | yes    |
| `DIRECT_URL`                                          | P     | for migrations   | falls back to `DATABASE_URL` | Neon **direct** URL of the same database; used only by Prisma CLI                    | yes    |
| `TEST_DATABASE_URL`                                   | tests | for integration  | local `calmcash_test`        | never set in deployments; must end in `_test` and differ from `DATABASE_URL`         | yes    |
| `CORS_ORIGINS`                                        | A (W) | A: yes           | `http://localhost:3000`      | exact HTTPS origins, comma-separated, no paths/slashes; never `*`                    | no     |
| `WEB_APP_URL`                                         | A W   | W: yes (or CORS) | first CORS origin            | canonical HTTPS frontend origin; must be in `CORS_ORIGINS`; used in e-mail links     | no     |
| `TRUST_PROXY_HOPS`                                    | A     | no (0)           | `0`                          | number of trusted proxies (`1` behind Vercel); wrong values break per-IP rate limits | no     |
| `API_HOST`/`API_PORT`                                 | A     | no               | `localhost:4000`             | container: `0.0.0.0:4000` (set in `Dockerfile.api`); Vercel assigns `PORT` itself    | no     |
| `JSON_BODY_LIMIT`                                     | A     | no               | `100kb`                      | keep small; uploads use their own raw-body limits (4 MB receipts)                    | no     |
| `LOG_LEVEL`                                           | A W   | no               | `info`                       | `info` (`debug` only temporarily; logs never contain secrets or financial details)   | no     |
| `SHUTDOWN_TIMEOUT_MS`                                 | A W   | no               | `10000`                      | below the platform's stop grace period (e.g. 25 000 with a 30 s grace)               | no     |
| `SESSION_MAX_AGE_DAYS` / `SESSION_IDLE_TIMEOUT_HOURS` | A     | no               | `14` / `72`                  | policy decision; idle ≤ max age (validated)                                          | no     |
| `OPS_STATUS_TOKEN`                                    | A     | no               | unset (endpoint off)         | ≥ 32 random characters to enable `GET /api/v1/health/status` for monitors            | yes    |

## E-mail (API and worker read the same rules)

| Variable                     | Req.        | Development behaviour                                                         | Production requirement                                                  | Secret  |
| ---------------------------- | ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------- |
| `EMAIL_DELIVERY_MODE`        | prod: yes   | `mailpit` default; only `localhost`/`127.0.0.1`/`::1`/`mailpit` hosts allowed | `smtp` (or `disabled`); never implied                                   | no      |
| `SMTP_HOST`, `SMTP_PORT`     | with `smtp` | Mailpit `localhost:1025`; external hosts refused outside production           | provider host; `587` + `SMTP_SECURE=false` (STARTTLS) or `465` + `true` | no      |
| `SMTP_SECURE`                | no          | `false`                                                                       | per provider                                                            | no      |
| `SMTP_USER`, `SMTP_PASSWORD` | together    | unset                                                                         | provider credentials                                                    | **yes** |
| `EMAIL_FROM`                 | prod: yes   | `CalmCash <no-reply@calmcash.localhost>`                                      | verified sender of the provider                                         | no      |

## Receipts

| Variable                   | Req.                | Development behaviour      | Production requirement                                                    | Secret  |
| -------------------------- | ------------------- | -------------------------- | ------------------------------------------------------------------------- | ------- |
| `RECEIPT_STORAGE_PROVIDER` | no (`local`)        | `local`                    | `vercel-blob` on Vercel (enforced); `local` only with a persistent volume | no      |
| `RECEIPT_STORAGE_DIR`      | prod + `local`: yes | `.data/receipts` (ignored) | a private directory on a persistent volume (e.g. `/data/receipts`)        | no      |
| `BLOB_READ_WRITE_TOKEN`    | with `vercel-blob`  | unset                      | injected by the connected **private** Blob store; server-side only        | **yes** |

## AI (local Ollama only)

| Variable                                                                                                                                                                    | Default                  | Production                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `AI_ENABLED`                                                                                                                                                                | `true`                   | **`false` on Vercel** (no private model reachable). Everything else works. |
| `OLLAMA_BASE_URL`                                                                                                                                                           | `http://127.0.0.1:11434` | loopback/private network only (validated); never a public endpoint         |
| `OLLAMA_MODEL`                                                                                                                                                              | `qwen3:1.7b`             | a model pulled on that private server                                      |
| `OLLAMA_REQUEST_TIMEOUT_MS`, `OLLAMA_MAX_CONCURRENT_REQUESTS`, `OLLAMA_MAX_QUEUED_REQUESTS`, `OLLAMA_CONTEXT_TOKENS`, `OLLAMA_MAX_OUTPUT_TOKENS`, `OLLAMA_DISABLE_THINKING` | bounded defaults         | size to the model host's CPU/RAM                                           |
| `AI_MAX_PROMPT_CHARS`, `AI_MAX_REQUESTS_PER_USER`, `AI_RATE_WINDOW_MINUTES`                                                                                                 | `12000`, `30`, `10`      | per-user limit, shared across instances (PostgreSQL counters)              |

## Worker

| Variable                                    | Default             | Notes                                                                                 |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `WORKER_ID`                                 | host + pid          | stable name in leases and heartbeats; `[A-Za-z0-9._:-]{1,80}`                         |
| `WORKER_POLL_INTERVAL_MS`                   | `5000`              | idle pause between cycles (250–60 000)                                                |
| `WORKER_BATCH_SIZE`                         | `20`                | jobs and e-mails claimed per cycle (1–100)                                            |
| `WORKER_LEASE_MS`                           | `120000`            | a claim older than this is recovered by any worker (30 s–15 min)                      |
| `WORKER_SCHEDULER_INTERVAL_MS`              | `300000`            | how often daily reviews and maintenance are enqueued (idempotent)                     |
| `WORKER_DAILY_REVIEW_HOUR`                  | `8`                 | local hour of each user's daily review                                                |
| `WORKER_HEALTH_HOST` / `WORKER_HEALTH_PORT` | `127.0.0.1` / unset | `GET /health` for supervisors; the image sets `0.0.0.0:8080`; never route it publicly |

## Web build (inlined into the browser bundle — never secrets)

| Variable                                                          | Behaviour                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                                             | API origin for standalone development (`http://localhost:4000`). Empty on Vercel (forced): same-origin `/api/v1`. |
| `NEXT_PUBLIC_SERVICE_WORKER`                                      | `off` unregisters the service worker in every browser on the next visit (kill switch).                            |
| `APP_VERSION`                                                     | Build version for the service-worker update check. Vercel uses its deployment ID automatically.                   |
| `VERCEL`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_SHA`, `PORT` | Set by Vercel; never set manually.                                                                                |

`scripts/check-artifacts.mjs --production` fails a build whose browser assets contain a connection
string, a Blob token, a server-only variable name, a private key, a localhost/private-network
origin, or a source map.
