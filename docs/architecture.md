# CalmCash architecture

This document describes how the CalmCash codebase is organised, how its parts communicate, and the
rules that keep features decoupled as the product grows. It reflects the Phase 1 foundation, the
Phase 3 authentication layer (detailed in [authentication.md](./authentication.md)), the Phase 4
accounts module, the Phase 5 transactions, categories, and tags modules, the Phase 6 dashboard,
the Phase 7 planning modules (budgets, recurring schedules, subscriptions, savings goals), the Phase 8
statement imports and receipts, and the Phase 9 notifications and background worker.

## 1. Overview

CalmCash is a pnpm monorepo with three deployable applications — the web app, the API, and (since
Phase 9) the background worker, described in [§18](#18-notifications-and-automation-phase-9) — and
one shared library:

```text
            ┌──────────────────────────┐   HTTPS + JSON (/api/v1)   ┌──────────────────────────┐
 Browser ──▶│ apps/web                 │ ─────────────────────────▶ │ apps/api                 │
            │ Next.js App Router (UI)  │ ◀───────────────────────── │ Express REST API         │
            └────────────┬─────────────┘   { success, data|error }  └────────────┬─────────────┘
                         │                                                       │ Prisma Client
                         │ import                                         import │ + pg driver adapter
                         ▼                                                       ▼
            ┌───────────────────────────────────────────────┐         ┌──────────────────────────┐
            │ packages/shared                               │         │ PostgreSQL               │
            │ DTO types · Zod schemas · constants · money   │         │ schema: prisma/          │
            └───────────────────────────────────────────────┘         └──────────────────────────┘
```

| Path                | Responsibility                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `apps/web`          | User interface. Talks to the API over HTTP only — never to the database.           |
| `apps/api`          | HTTP API with database access. Owns validation and business rules.                 |
| `apps/worker`       | Background process: reminders, alerts, summaries, e-mail (reuses the API's rules). |
| `packages/shared`   | Isomorphic contracts used by both apps: DTO types, Zod schemas, constants, money.  |
| `prisma/`           | Database schema and versioned SQL migrations.                                      |
| `prisma.config.ts`  | Prisma CLI configuration (schema path, migrations path, connection URL).           |
| `compose.yaml`      | Local PostgreSQL and the Mailpit e-mail catcher for development.                   |
| `eslint.config.mjs` | One lint configuration for the whole workspace.                                    |

## 2. Repository layout

```text
apps/
  api/src/
    app.ts                 Express app factory (no network binding — testable in-process)
    server.ts              Process entry: env validation, dependency wiring, listen, shutdown
    config/env.ts          Typed, validated runtime configuration
    lib/                   Cross-cutting infrastructure (errors, logging, DB client, e-mail, auth boundary, …)
    middleware/            Request logging, origin check, validation convention, 404, error handler
    modules/<feature>/     Feature modules (routes → controller → service → repository): health, auth,
                           accounts, transactions, categories, tags, dashboard, budgets, recurring,
                           subscriptions, goals, imports, receipts
    automation/            Worker engine (jobs, scheduler, alerts, reminders, summaries, e-mail delivery)
    testing/               Test app factories, in-memory e-mail and file storage, integration harness
    routes/v1.ts           Composition root of API v1: mounts every module router
    generated/prisma/      Generated Prisma Client (git-ignored; `pnpm db:generate`)
  worker/src/
    main.ts                Worker process: env, logger, Prisma, transport, signals, health endpoint
    cli.ts                 Operator commands: queue status, requeue failed jobs
  web/src/
    app/                   Routes only: root layout, (app) route group with the shell, boundaries
    features/<feature>/    Feature modules: components and view logic for one capability
    components/            Feature-agnostic design system (see docs/ui-architecture.md)
      ui/                  shadcn/ui primitives (owned source)
      brand/ layout/ theme/ feedback/ finance/ forms/ charts/
    testing/               Test setup and helpers (auth context values)
    hooks/                 Reusable React hooks
    lib/                   Infrastructure: env, API client, navigation, formatting, preferences
    services/              One module per API resource; returns validated shared DTOs
    types/                 Web-only types (e.g. async UI state)
packages/shared/src/
  constants/               Domain literals, currencies, API constants, BIGINT bounds
  types/                   DTO interfaces and API envelopes
  schemas/                 Zod schemas mirroring every DTO
  money/                   BigInt-based minor-unit helpers
  analytics/               Calendar periods, trend buckets, basis-point ratios (pure, clock-free)
  planning/                Budget periods and progress, recurrence engine, goal progress (pure)
  index.ts                 The package's only public entry point
prisma/
  schema.prisma
  migrations/
docs/
```

## 3. Shared package (`@calmcash/shared`)

**What belongs here:** API-facing DTO interfaces, their Zod schemas, literal unions (account types,
transaction types, …), API constants (version prefix, error codes), and pure helpers whose result
must be identical in the browser and on the server (minor-unit parsing and serialisation).

**What does not:** business rules, database access, React, Express, or anything that needs Node.js
or DOM APIs. `packages/shared/tsconfig.json` sets `lib: ["ES2022"]` and `types: []`, so using a
Node.js or browser global there is a compile error.

**One definition, checked twice.** Every DTO is declared as an explicit `interface` (readable
documentation) and as a Zod schema (runtime validation). Each schema is declared with
`satisfies z.ZodType<TheDto>`, and `src/schemas/contracts.test.ts` asserts with `expectTypeOf`
that the schema's inferred type _equals_ the interface. Drift between the two fails `pnpm typecheck`.

**Build strategy — internal TypeScript package.** The package's `exports` point at its TypeScript
source (`src/index.ts`); there is no separate build step and no `dist/` that can go stale.

| Consumer          | How `@calmcash/shared` is compiled                                              |
| ----------------- | ------------------------------------------------------------------------------- |
| Web (dev & build) | Turbopack transpiles workspace packages automatically.                          |
| API (dev)         | `node --watch --import tsx` loads the TypeScript source and restarts on edits.  |
| API (build)       | `tsup` bundles it into `dist/server.js` (`noExternal`); npm deps stay external. |
| Type-checking     | Each consumer's `tsc` checks the source under its own strict configuration.     |
| Tests             | Vitest transforms it like any other source file.                                |

Always import from the package root (`import { … } from '@calmcash/shared'`); deep imports into
`src/` are not part of the contract.

## 4. Frontend ↔ backend communication

- **Transport:** JSON over HTTP. All endpoints live under the version prefix `API_V1_PREFIX`
  (`/api/v1`), defined once in the shared package.
- **Configuration:** the web app knows only the API origin (`NEXT_PUBLIC_API_URL`, validated in
  `apps/web/src/lib/env.ts`); the API client appends the version prefix.
- **Envelope:** every response is either `{ success: true, data }` or
  `{ success: false, error: { code, message, details?, requestId? } }` (`ApiResponse<T>`).
- **Runtime validation on both sides:** the API validates requests with Zod; the web client
  validates every response payload with the corresponding shared schema before using it. A
  response that does not match the contract is reported as `INVALID_RESPONSE` — malformed data
  never reaches components.
- **Layering in the web app:** `components` → `hooks` → `features` → `services/*.service.ts`
  → `lib/api.ts` (configured `createApiClient` instance) → `fetch`. Components never call `fetch`.
- **Errors:** the client throws only `ApiClientError`, carrying the API's `code`, HTTP status,
  field `details`, and `requestId`. Client-side failures use `NETWORK_ERROR` and `INVALID_RESPONSE`.
  Caller-initiated aborts are re-thrown unchanged.
- **CORS and sessions:** the API accepts browser requests only from `CORS_ORIGINS`, with credentials.
  The client sends `credentials: 'include'`, so the browser attaches the HttpOnly session cookie, and
  adds the in-memory CSRF token as `x-csrf-token` on state-changing requests. Requests that record
  money may also carry an `Idempotency-Key` header (allowed by CORS). A `401 UNAUTHORIZED`
  ends the client-side session; a `403 CSRF_TOKEN_INVALID` refreshes the token and retries once. See
  [authentication.md](./authentication.md).
- **Request IDs:** the API assigns (or accepts a well-formed) `x-request-id`, returns it as a
  header, includes it in error bodies, and logs it — users can quote it in bug reports.

## 5. API request lifecycle and module organisation

Middleware order (`apps/api/src/app.ts`):

1. **Request logger** (`pino-http`) — assigns the request ID, logs one line per request.
2. **Helmet** — security headers.
3. **CORS** — explicit origin allow-list.
4. **Origin check** — rejects state-changing requests from other sites (`403 ORIGIN_NOT_ALLOWED`).
5. **JSON body parser** — size-limited by `JSON_BODY_LIMIT`; only `application/json`.
6. **`/api/v1` router** — module routers. Protected auth routes add `requireSession`, `requireCsrf`,
   and rate limiters per route.
7. **Not-found handler** — typed 404 envelope.
8. **Error handler** — converts every error into the error envelope.

Each feature is a self-contained module under `apps/api/src/modules/<feature>/`:

| File                      | Responsibility                                                                |
| ------------------------- | ----------------------------------------------------------------------------- |
| `<feature>.routes.ts`     | Router factory: paths, request validation (`validateRequest`), wiring.        |
| `<feature>.controller.ts` | Thin HTTP adapter: input → service call → `sendSuccess` / `AppError`.         |
| `<feature>.service.ts`    | Business logic. Framework-free and unit-testable with fakes.                  |
| `<feature>.repository.ts` | Database access through Prisma (added when the module persists data).         |
| `<feature>.mapper.ts`     | Database model → shared DTO (BigInt → string, `Date` → ISO, `null` → absent). |

Dependencies are passed explicitly through factory functions (`createHealthRouter({ checkDatabase })`).
`server.ts` is the only place that creates singletons (logger, Prisma client); `routes/v1.ts` is the
composition root that hands each module only what it needs. There is no service locator or global
container, so every dependency is visible in a function signature.

## 6. Validation and database access flow

```text
HTTP request
  └─ validateRequest(schema)        Zod over { params, query, body } → typed input or 400 VALIDATION_ERROR
       └─ controller                 maps HTTP ↔ service; no logic
            └─ service               business rules, ownership checks (userId scoping)
                 └─ repository       Prisma Client (typed queries, transactions)
                      └─ PostgreSQL  FKs, unique constraints, CHECK constraints (last line of defence)
HTTP response
  └─ mapper → shared DTO → sendSuccess(res, dto)   (DB-only fields never leave the API)
```

The validation convention is one Zod schema per route describing the whole request:

```ts
const createTransferRequest = z.object({
  params: z.object({ accountId: entityIdSchema }),
  body: z.object({ amountMinor: positiveMinorUnitsSchema, toAccountId: entityIdSchema }),
});

router.post(
  '/:accountId/transfers',
  validateRequest(
    createTransferRequest,
    async (input, _req, res: Response<ApiSuccessResponse<TransactionDto>>) => {
      sendSuccess(res, await transferService.create(input.params.accountId, input.body), 201);
    },
  ),
);
```

Handlers receive parsed, typed input, and annotating `res` type-checks the response payload.
TypeScript interfaces never stand in for runtime validation of untrusted input.

## 7. Error handling

**API** (`middleware/error-handler.ts`):

| Thrown value                      | Response                                         |
| --------------------------------- | ------------------------------------------------ |
| `AppError(status, code, message)` | That status, code, and message (safe by design). |
| `ZodError`                        | 400 `VALIDATION_ERROR` with per-field `details`. |
| Malformed JSON body               | 400 `INVALID_JSON`.                              |
| Body above `JSON_BODY_LIMIT`      | 413 `PAYLOAD_TOO_LARGE`.                         |
| Any other 4xx `http-errors` value | Its status with `BAD_REQUEST`.                   |
| Anything else                     | 500 `INTERNAL_ERROR` with a generic message.     |

Only expected errors expose their message. Unexpected errors are logged with their stack and the
request ID, while the client receives a generic message — internal details (SQL, hosts,
credentials) never leak. Express 5 forwards rejected promises from async handlers automatically.

**Web:** `app/error.tsx` (segment errors, with `retry()`), `app/global-error.tsx` (root layout
failures), `app/not-found.tsx` (unknown URLs, real 404 status), and `app/loading.tsx` (streaming
fallback). Error boundaries receive `error: unknown` and narrow it before reading properties.

## 8. Environment configuration

| Variable                                | Used by           | Purpose                                                         | Default                       |
| --------------------------------------- | ----------------- | --------------------------------------------------------------- | ----------------------------- |
| `POSTGRES_USER`                         | Docker Compose    | Local database user                                             | —                             |
| `POSTGRES_PASSWORD`                     | Docker Compose    | Local database password                                         | —                             |
| `POSTGRES_DB`                           | Docker Compose    | Local database name                                             | —                             |
| `POSTGRES_PORT`                         | Docker Compose    | Host port of the container (loopback only)                      | `5433`                        |
| `DATABASE_URL`                          | Prisma CLI, API   | PostgreSQL connection URL                                       | — (required)                  |
| `NODE_ENV`                              | API               | `development` \| `test` \| `production`                         | `development`                 |
| `API_HOST`                              | API               | Bind address                                                    | `localhost`                   |
| `API_PORT`                              | API               | Port                                                            | `4000`                        |
| `CORS_ORIGINS`                          | API               | Comma-separated browser origins                                 | — (required)                  |
| `JSON_BODY_LIMIT`                       | API               | Max JSON body size                                              | `100kb`                       |
| `LOG_LEVEL`                             | API               | pino level                                                      | `info`                        |
| `SHUTDOWN_TIMEOUT_MS`                   | API               | Grace period for in-flight requests                             | `10000`                       |
| `WEB_APP_URL`                           | API               | Web origin used in e-mailed links                               | 1st CORS origin               |
| `TRUST_PROXY_HOPS`                      | API               | Trusted reverse proxies (client IPs)                            | `0`                           |
| `SESSION_MAX_AGE_DAYS`                  | API               | Absolute session lifetime                                       | `14`                          |
| `SESSION_IDLE_TIMEOUT_HOURS`            | API               | Idle timeout of a session                                       | `72`                          |
| `EMAIL_DELIVERY_MODE`                   | API, worker       | `mailpit`, `smtp` (production only), `disabled`                 | `mailpit` (not in production) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | API, worker       | SMTP server (Mailpit locally)                                   | `localhost`, `1025`, `false`  |
| `SMTP_USER`, `SMTP_PASSWORD`            | API, worker       | SMTP credentials (both or neither; `smtp` only)                 | none                          |
| `EMAIL_FROM`                            | API, worker       | Sender of transactional e-mail                                  | local placeholder             |
| `WORKER_*`                              | Worker            | ID, poll interval, batch, lease, scheduler, review hour, health | see `.env.example`            |
| `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`  | Docker Compose    | Mailpit host ports                                              | `1025`, `8025`                |
| `RECEIPT_STORAGE_DIR`                   | API               | Private directory for receipt files                             | `.data/receipts` (dev only)   |
| `TEST_DATABASE_URL`                     | Integration tests | Disposable `*_test` database                                    | — (tests only)                |
| `NEXT_PUBLIC_API_URL`                   | Web (build time)  | API origin, without `/api/v1`                                   | — (required)                  |

- Backend and database variables live in the repository-root `.env` (template: `.env.example`).
  The API loads it with Node's `--env-file-if-exists`; `prisma.config.ts` loads it with
  `process.loadEnvFile`. Variables already present in the environment take precedence.
- Web variables live in `apps/web/.env.local` (template: `apps/web/.env.example`). `NEXT_PUBLIC_*`
  values are inlined at build time, so they must be set before `next build` and must never be
  secrets.
- The API validates its environment once at startup (`config/env.ts`) and exits with a list of
  offending **variable names** — values are never printed. Application code reads the typed
  `AppConfig`, never `process.env`.

## 9. Logging, security, and process lifecycle

- **Logging:** structured JSON via pino. Request logs contain method, URL, status, duration, and
  request ID — headers are not logged, and `authorization`/`cookie` are redacted as a safeguard.
  Health probes are excluded from request logging.
- **Security baseline:** Helmet headers, explicit CORS allow-list, origin verification, JSON-only
  body parsing with a size limit, no `X-Powered-By`, PostgreSQL and Mailpit bound to `127.0.0.1` in
  development. Authentication adds hashed server-side sessions, HttpOnly `SameSite=Strict` cookies,
  synchronizer CSRF tokens, Argon2id, and rate limits ([authentication.md](./authentication.md)).
- **Health:** `GET /api/v1/health` (liveness, no dependencies) and `GET /api/v1/health/ready`
  (readiness, checks PostgreSQL; 503 when unavailable). Both send `Cache-Control: no-store`.
- **Housekeeping:** an hourly job deletes sessions and tokens that have been unusable for a week.
  E-mails that must not shape a response (password reset, resend) run as background tasks.
  Scheduled and retried work (notifications, reminders, notification e-mail) belongs to the separate
  worker process and its PostgreSQL job tables (§18), never to the API's in-process timers.
- **Graceful shutdown** (`lib/shutdown.ts`): on SIGINT/SIGTERM the server stops accepting
  connections, closes idle keep-alive sockets, waits for in-flight requests (bounded by
  `SHUTDOWN_TIMEOUT_MS`), stops the cleanup job, waits for background e-mails, closes SMTP,
  disconnects Prisma, then exits. Uncaught exceptions and unhandled
  rejections trigger the same sequence with exit code 1.

## 10. Adding a feature without coupling

Example: an `accounts` feature.

1. **Contracts** — in `packages/shared`, add or refine the DTO interface and schema, plus request
   schemas (e.g. `createAccountInputSchema`). Export them from `src/index.ts`. Keep the
   `contracts.test.ts` equality assertions in sync.
2. **Database** — edit `prisma/schema.prisma`, run `pnpm db:migrate --name add_account_archiving`.
   Add hand-written CHECK constraints with `--create-only` when needed (see
   [database-design.md](./database-design.md)).
3. **API module** — create `apps/api/src/modules/accounts/` with routes, controller, service,
   repository, and mapper. Mount it in `routes/v1.ts`. Scope every query by `userId`.
4. **Web** — add `services/accounts.service.ts`, then `features/accounts/` (components, hooks),
   then the route under `app/`.
5. **Tests** — service unit tests with fakes, HTTP tests with supertest against `createApp`,
   schema tests in the shared package.

Rules that keep modules independent:

- A module never imports another module's internals. If `budgets` needs account data, it receives
  an `AccountService`-shaped dependency through the composition root. A module that other modules
  must build on publishes an explicit `index.ts` (the accounts module exports the balance arithmetic
  and the ledger query/lock there, and transactions import only that).
- Routes in `apps/web/src/app` stay thin: they compose features, they do not contain business logic.
- Features import from `components`, `hooks`, `lib`, `services`, and `types`; they never import
  from other features' internals — only from a feature's `index.ts` when sharing is intended.
- The shared package never imports from an app.

## 11. Technology decisions

| Decision                                      | Rationale                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| TypeScript 6.0                                | Latest JS-API release. TS 7 (native) is not yet supported by `typescript-eslint` (`<6.1`).                     |
| ESLint 9.39                                   | `eslint-config-next` 16.4 and its React/import/a11y plugins target ESLint 9; v10 is not yet supported.         |
| Prisma 7.10 (stable)                          | npm's `latest` tag currently points at an 8.0 release candidate; prereleases are avoided.                      |
| Prisma `prisma-client` + `@prisma/adapter-pg` | Rust-free client generated as TypeScript, bundle-friendly, pg connection pooling.                              |
| Express 5                                     | Native async error propagation; stable.                                                                        |
| Next.js 16 + Turbopack                        | Default bundler; Tailwind CSS v4 runs as a Turbopack loader (`@tailwindcss/turbopack`).                        |
| `node --watch --import tsx` for API dev       | Node's built-in watcher works reliably under `pnpm --parallel`; tsx's own watcher did not on Windows.          |
| Shared package as TypeScript source           | No stale build output; one strict type-check; bundled into the API by tsup.                                    |
| PostgreSQL 18 (Docker)                        | Current stable major; port 5433 avoids clashing with a native install.                                         |
| Money as BIGINT minor units                   | Exact integer arithmetic; serialised as strings in JSON. See the database design.                              |
| shadcn/ui primitives (new-york, Radix)        | Accessible, owned component source; restyled through CalmCash tokens.                                          |
| `clsx` + `tailwind-merge` for `cn`            | Stable, established helper; the shadcn v4 CLI's `cn` package is pre-1.0.                                       |
| Custom theme/sidebar preference store         | Pre-paint inline script per the Next.js guide; avoids `next-themes`' client-rendered script warning.           |
| Geist via the `geist` package                 | Fonts bundled from npm with `next/font/local`; builds never fetch fonts.                                       |
| Opaque sessions in PostgreSQL (no JWT)        | Instant revocation, server-side expiry, nothing secret readable by scripts; one database round trip.           |
| `argon2` (node-argon2) for Argon2id           | Reference C implementation with bundled N-API prebuilds (`allowBuilds` only compiles as a fallback).           |
| HMAC-derived CSRF token, hash stored          | Synchronizer token bound to the session that survives page reloads without storing it in clear.                |
| `express-rate-limit` (memory store)           | Maintained, typed, standard headers; swap the store for Redis before running several instances.                |
| nodemailer (`~10.0`) + Mailpit                | Provider-neutral SMTP behind a small `EmailService` interface; Mailpit keeps local mail on the machine.        |
| Testing Library + jsdom (per-file opt-in)     | Real interaction tests for forms and guards; static-markup tests stay in plain Node.                           |
| PostgreSQL job tables for the worker          | `FOR UPDATE SKIP LOCKED` claims, leases, and unique keys give a durable queue without Redis or a paid service. |
| Worker imports `@calmcash/api/automation`     | One explicit entry point reuses the API's services instead of copying financial rules into a new package.      |

## 12. Prepared for later phases

- **Design system and app shell (Phase 2, done):** tokens, components, responsive navigation, and
  prototype screens are documented in [ui-architecture.md](./ui-architecture.md). Prototype pages
  take typed props, so later phases replace fixtures with API data without touching the shell.
- **PWA:** `metadata`, `viewport.themeColor`, safe-area padding, and an app icon are in place;
  a web manifest (`app/manifest.ts`) and service worker are deliberately left for the PWA phase.
- **Authentication (Phase 3, done):** see [authentication.md](./authentication.md).
- **Accounts (Phase 4, done):** see [§13](#13-accounts-module-phase-4) and the balance rules in
  [database-design.md](./database-design.md#3a-accounts-and-balance-semantics-phase-4).
- **Transactions (Phase 5, done):** see [§14](#14-transactions-categories-and-tags-phase-5) and
  [database-design.md §3b](./database-design.md#3b-transactions-categories-and-tags-phase-5).
- **Dashboard (Phase 6, done):** see [§15](#15-dashboard-and-analytics-phase-6) and the metric
  definitions in [database-design.md §3c](./database-design.md#3c-dashboard-metrics-phase-6).
- **Planning (Phase 7, done):** see [§16](#16-planning-phase-7) and
  [database-design.md §3d](./database-design.md#3d-budgets-recurring-schedules-subscriptions-and-goals-phase-7).
- **Statement imports and receipts (Phase 8, done):** see
  [§17](#17-statement-imports-and-receipts-phase-8) and
  [database-design.md §3e](./database-design.md#3e-statement-imports-and-receipts-phase-8).
- **Notifications and automation (Phase 9, done):** see
  [§18](#18-notifications-and-automation-phase-9) and
  [database-design.md §3f](./database-design.md#3f-notifications-and-automation-phase-9).

## 13. Accounts module (Phase 4)

Protected modules receive the session boundary from the auth module through the composition root
(`routes/v1.ts`): `requireSession`, `requireCsrf`, and
`getCaller(req) → { userId, timeZone, preferredCurrency }`.
The accounts module never reads cookies or imports auth internals, and it never takes an owner
from the request: every query is scoped by `getCaller(req).userId`.

| Method & path                       | Purpose                                                            | Success |
| ----------------------------------- | ------------------------------------------------------------------ | ------- |
| `GET /accounts`                     | List (`?status=active\|archived\|all`, default `active`; `?type=`) | 200     |
| `GET /accounts/summary`             | Active totals per currency: assets and liabilities apart           | 200     |
| `POST /accounts`                    | Create                                                             | 201     |
| `GET /accounts/:accountId`          | One account with its balance                                       | 200     |
| `PATCH /accounts/:accountId`        | Update (partial; `null` clears optional fields)                    | 200     |
| `POST /accounts/:accountId/archive` | Archive (idempotent)                                               | 200     |
| `POST /accounts/:accountId/restore` | Restore (idempotent)                                               | 200     |

- Every route requires a session; state-changing routes also require the CSRF token, and all
  responses are `Cache-Control: no-store`.
- Bodies are strict Zod objects from `packages/shared/src/schemas/account.ts` (unknown fields such
  as `userId`, `status`, or `archivedAt` are rejected); path IDs must be UUIDs.
- An account that does not exist and one that belongs to someone else both answer
  `404 NOT_FOUND` with the same message.
- Responses are `AccountWithBalanceDto` (`{ account, balance, hasTransactions }`); lists are
  ordered active first, then by creation time.
- Layout: `account-balance.ts` (pure balance math) · `accounts.repository.ts` (Prisma, one
  aggregate SQL for balances, row-locked updates) · `accounts.service.ts` (rules, edit policy) ·
  `accounts.mapper.ts` (row → DTO) · `accounts.controller.ts` · `accounts.routes.ts`.
- Logs contain only the method, URL, status, and request ID — never balances or account details.

## 14. Transactions, categories, and tags (Phase 5)

All routes require a session; state-changing ones the CSRF token. Responses are
`Cache-Control: no-store`. Bodies and queries are strict Zod schemas from
`packages/shared/src/schemas/transaction.ts` and `category.ts`, so unknown fields and query
parameters (including owner IDs, currencies, statuses, and arbitrary sort keys) are rejected.

| Method & path                                | Purpose                                                                                                                                             | Success          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `GET /transactions`                          | List: `q`, `type`, `accountId`, `categoryId`, `paymentMethod`, `tags`, `from`, `to`, `minAmount`, `maxAmount`, `status`, `sort`, `page`, `pageSize` | 200              |
| `GET /transactions/summary`                  | Income, spending, and net per currency for the same filters                                                                                         | 200              |
| `POST /transactions`                         | Record income, an expense, a transfer, or an adjustment (`Idempotency-Key` optional)                                                                | 201 (200 replay) |
| `GET /transactions/:id`                      | One transaction with its account(s) and category                                                                                                    | 200              |
| `PATCH /transactions/:id`                    | Edit (partial; `null` clears; type changes allowed when the result is complete)                                                                     | 200              |
| `POST /transactions/:id/void`                | Void (optional `reason`; idempotent)                                                                                                                | 200              |
| `POST /transactions/:id/restore`             | Undo a void (idempotent)                                                                                                                            | 200              |
| `POST /transactions/bulk`                    | `set_category`, `add_tags`, `remove_tags`, or `void` for 1–100 IDs, all or nothing                                                                  | 200              |
| `POST /transactions/reconciliations/preview` | Compare an observed balance with CalmCash's at an instant                                                                                           | 200              |
| `POST /transactions/reconciliations`         | Record the confirmed adjustment (`expectedAdjustmentMinor`, `Idempotency-Key`)                                                                      | 201 (200 replay) |
| `GET /categories`                            | The user's categories (defaults provisioned once, on first use)                                                                                     | 200              |
| `POST /categories`                           | Create a category or subcategory                                                                                                                    | 201              |
| `PATCH /categories/:id`                      | Rename                                                                                                                                              | 200              |
| `POST /categories/:id/archive` / `restore`   | Archive (with subcategories) / restore; idempotent                                                                                                  | 200              |
| `GET /tags`                                  | Tags on active transactions, most used first (suggestions)                                                                                          | 200              |

- **List contract.** `TransactionPageDto { items, pagination: { page, pageSize, totalItems,
totalPages } }`; `pageSize` defaults to 25 and is capped at 100. Every sort (`newest`, `oldest`,
  `largest`, `smallest`) ends with the ID, so pages never overlap. `from`/`to` are calendar dates in
  the user's time zone (`to` is inclusive); amount bounds are major units applied per currency with
  inward rounding (`amountFilterToMinorUnits`). Items are `TransactionListItemDto` (transaction plus
  account, transfer-destination, and category references), so lists render without extra calls.
- **Summary contract.** Built from the exact same `WHERE` clause as the list
  (`transaction-query.ts`), restricted to active income and expenses and grouped by currency —
  never added across currencies.
- **Errors.** Input problems are `400 VALIDATION_ERROR` with `body.<field>` details. State problems
  (archived account, would go below zero, voided transaction, stale reconciliation, reused key) are
  `409 CONFLICT`. Another user's transaction, category, or account answers exactly like a missing
  one (`404`, or `400 "Choose one of your accounts"` for a referenced ID).
- **Layout.** `transactions.routes.ts` · `transactions.controller.ts` (also reads the
  `Idempotency-Key` header) · `transactions.service.ts` (orchestrates each write inside a ledger) ·
  `transaction-rules.ts` (pure rules: merge, plan, balance checks, reconciliation) ·
  `transaction-query.ts` (filters → `WHERE`, sort allow-list, LIKE escaping) ·
  `transactions.repository.ts` (Prisma, row locks, ledger) · `transactions.mapper.ts`. Categories
  and tags are separate modules with the same layering. The shared session boundary type lives in
  `lib/auth-boundary.ts`.
- **Concurrency.** See [database-design.md §3b](./database-design.md#locking-and-concurrency): one
  database transaction per write, transaction rows then accounts locked in ID order, balances
  re-read under the lock, nothing committed unless every rule holds.

## 15. Dashboard and analytics (Phase 6)

Read-only aggregates over the Phase 4 and 5 data. Every route requires a session and answers
`Cache-Control: no-store`; there is no server-side or Redis cache, so figures are always as fresh as
the ledger.

| Method & path               | Purpose                                                                           | Success |
| --------------------------- | --------------------------------------------------------------------------------- | ------- |
| `GET /dashboard/overview`   | Position (now), cash flow, savings rate, and previous-period comparison           | 200     |
| `GET /dashboard/trends`     | Income and expenses per calendar bucket (day, ISO week, month, or year), 0-filled | 200     |
| `GET /dashboard/categories` | Spending per top-level category: top six, an exact "Other", and "Uncategorised"   | 200     |

- **Query.** `dashboardQuerySchema` (strict): `period` (`this-month` by default, `last-month`,
  `last-3-months`, `last-6-months`, `this-year`, or `custom` with both `from` and `to`), and an
  optional `currency`. Dates are rejected on presets; a custom end in the future or a start before
  1900 is `400 VALIDATION_ERROR` on that field. Ranges are computed in the caller's time zone by the
  clock-free helpers in `packages/shared/src/analytics/periods.ts`.
- **Currency.** Each response is about exactly one currency: the requested one, otherwise the
  user's preferred currency if they hold an account in it, otherwise their first account currency.
  `currencies` lists the ones they hold (preferred first) so the UI can offer a switch. Amounts are
  never added or converted across currencies. The financial position is the exception: it is the
  accounts module's per-currency summary, returned as is.
- **Contracts.** DTOs in `packages/shared/src/types/dashboard.ts`, Zod mirrors in
  `schemas/dashboard.ts`. Money is a minor-unit string; ratios (savings rate, changes, shares) are
  `RatioDto`, a discriminated union of `{ status: 'available', basisPoints }` and
  `{ status: 'unavailable', reason }`, so "no income" can never be mistaken for 0 %. Basis points are
  canonical integer strings without the BIGINT bound (a tiny income against a large spend gives a
  very large negative rate). The comparison is `available` or `unavailable` with
  `no_previous_activity`.
- **Boundary.** The caller's `preferredCurrency` joins `userId` and `timeZone` on `Caller`
  (`lib/auth-boundary.ts`). The financial position comes from the accounts service's `summary`,
  built once in the composition root (`routes/v1.ts`) and handed to the dashboard router, so the
  dashboard never re-implements balance rules or imports accounts internals.
- **Layout.** `dashboard.routes.ts` · `dashboard.controller.ts` · `dashboard.service.ts` (resolves
  the period and currency once per request, then runs the independent queries in parallel) ·
  `dashboard-metrics.ts` (pure: range resolution, currency choice, ratios, comparison, trend
  filling, category ranking) · `dashboard.repository.ts` (raw aggregate SQL; rows parsed with Zod).
- **Consistency.** Each response is computed from its own queries; the overview's current and
  previous totals come from one query, so they share a snapshot. The three endpoints are separate
  requests, so a write between them can show in one section before another — the next load agrees.

## 16. Planning (Phase 7)

Four independent modules on top of the ledger. Every route requires a session; state-changing
routes also require the CSRF token; responses are `Cache-Control: no-store`. Bodies and queries are
strict Zod schemas from `packages/shared/src/schemas/{budget,recurring,subscription,goal}.ts`, so
owner IDs, statuses, cursors, archive times, and subscription flags sent by a client are rejected.
Another user's budget, schedule, subscription, or goal answers exactly like a missing one (`404`).

| Method & path                                                                      | Purpose                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /budgets`                                                                     | Budgets with progress (`status`, `period`, `categoryId`, `currency`, `date`) |
| `GET /budgets/summary`                                                             | Status counts, totals per cadence (no double counting), highlights           |
| `POST /budgets` · `GET`/`PATCH /budgets/:id`                                       | Create, read (`?date=`), update                                              |
| `POST /budgets/:id/archive` · `…/restore`                                          | Archive / restore (idempotent)                                               |
| `GET /recurring` · `GET /recurring/upcoming`                                       | Schedules; overdue and due occurrences (`from`, `to`, ≤ 366 days)            |
| `POST /recurring` · `GET`/`PATCH /recurring/:id`                                   | Create, details (next occurrences and history), update                       |
| `POST /recurring/:id/pause` · `resume` · `archive` · `restore` · `end`             | Lifecycle                                                                    |
| `POST /recurring/:id/occurrences/:date/record`                                     | Record the real transaction (201, or 200 when already recorded)              |
| `POST /recurring/:id/occurrences/:date/skip` · `unskip` · `postpone`               | Occurrence actions                                                           |
| `GET /subscriptions` · `GET /subscriptions/summary`                                | Subscriptions with twelve-month estimates; estimates per currency            |
| `POST /subscriptions` · `GET`/`PATCH /subscriptions/:id`                           | Create (always an expense schedule), read, update                            |
| `POST /subscriptions/:id/pause` · `resume` · `cancel` · `archive` · `restore`      | Lifecycle                                                                    |
| `GET /goals` · `POST /goals` · `GET`/`PATCH /goals/:id`                            | Savings goals with progress                                                  |
| `POST /goals/:id/contributions`                                                    | Add, withdraw, or set the tracked amount (planning allocation)               |
| `POST /goals/:id/pause` · `resume` · `complete` · `reopen` · `archive` · `restore` | Lifecycle                                                                    |

- **Budgets** (`modules/budgets`): `budget-metrics.ts` (pure: window per budget, progress DTO,
  totals without double counting) · `budgets.repository.ts` (one aggregate query for the spending
  of every listed budget — `unnest` of the windows joined to the expenses, so a list is one query,
  never one per budget; a per-user advisory lock serialises creates and edits for the overlap
  rule) · service · mapper · controller · routes.
- **Recurring** (`modules/recurring`): `recurring-engine.ts` (pure: status, cursor, pending
  occurrences, occurrence DTOs, built on the shared recurrence engine) · repository (schedule row
  lock, occurrence rows) · service · mapper · controller · routes. It publishes an `index.ts`
  because subscriptions reuse its service.
- **Subscriptions** (`modules/subscriptions`) hold no table and no date logic: a subscription is a
  recurring expense schedule with `is_subscription`. The module scopes requests to subscriptions and
  adds estimates from the recurring service's occurrences.
- **Goals** (`modules/goals`): goals and their contributions; the tracked amount is the sum of
  contributions, read with one grouped query for a list.
- **Recording money.** The composition root (`routes/v1.ts`) builds the recurring service with the
  transactions service. Confirming an occurrence calls `transactions.recordLinked(caller, input,
{ claim, commit })` (exported from `modules/transactions/index.ts`): inside the transaction
  module's ledger transaction, `claim` locks the schedule row and checks the occurrence, then the
  ordinary write path locks the accounts and applies every ownership, archive, date, category, and
  balance rule, and finally `commit` stores the occurrence as recorded and advances the cursor. The
  recurring module never writes transactions or balances itself. Lock order is schedule row, then
  accounts (by ID), so it never conflicts with ordinary writes, which lock accounts only.
- **Clock and time zone.** Every service takes an injectable `now()` and reads "today" with
  `calendarDateInTimeZone(now(), caller.timeZone)`. Due and overdue states are calculated on each
  request from persisted rules, so the pages never depend on a scheduler. (Since Phase 9 the worker
  reads the same states to send reminders; it never changes them.)

## 17. Statement imports and receipts (Phase 8)

Two modules. Every route requires a session; state-changing routes also require the CSRF token;
responses are `Cache-Control: no-store`. Requests are strict Zod schemas from
`packages/shared/src/schemas/{import,receipt}.ts`. Another user's import, row, transaction, or
receipt answers exactly like a missing one (`404`). The data model, duplicate rules, idempotency,
and reconciliation are in [database-design.md §3e](./database-design.md#3e-statement-imports-and-receipts-phase-8).

| Method & path                                                   | Purpose                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /imports` · `GET /imports/:id`                             | History (newest first); one import with sample rows and a proposed mapping  |
| `POST /imports?accountId=&fileName=[&delimiter=&hasHeaderRow=]` | Upload a CSV statement (raw body ≤ 2 MB) → `mapping`                        |
| `PUT /imports/:id/settings`                                     | Confirm columns, date layout, sign convention, statement info → `reviewing` |
| `POST /imports/:id/recheck`                                     | Look for duplicates again against the current ledger                        |
| `GET /imports/:id/rows` · `GET`/`PATCH …/rows/:rowId`           | Rows (`status`, `page`); one row; edit what will be recorded                |
| `POST …/rows/:rowId/decision`                                   | `match` · `not_duplicate` · `skip` · `restore`                              |
| `POST …/rows/classify`                                          | One category on several rows                                                |
| `POST /imports/:id/import`                                      | Record ≤ 200 rows; idempotent; partial success reported per row             |
| `GET …/reconciliation` · `POST …/reconciliation/adjustment`     | Balances at the statement's dates; the approved correction                  |
| `POST /imports/:id/complete` · `…/cancel`                       | Finish (raw cells discarded) or abandon (imported transactions stay)        |
| `GET`/`POST /transactions/:id/receipts`                         | Receipt metadata; upload one receipt (raw body ≤ 10 MB, `?fileName=`)       |
| `GET …/receipts/:receiptId/file` · `DELETE …/:receiptId`        | Stream the file (owner only); remove it                                     |

- **Imports** (`modules/imports`): `csv-parser.ts` (bounded RFC 4180 reader; refuses binary,
  spreadsheet, and PDF content) · `statement-reader.ts` (dates in a stated layout, amounts with a
  stated sign convention or split columns, proposals from header names; pure) ·
  `duplicate-detection.ts` (the three checks; pure) · `row-evaluation.ts` (rows → status, proposal,
  candidates; pure) · repository (batch and row locks, bulk row updates with `unnest`) · service ·
  mapper · controller · routes. Raw bodies are read with `express.raw` (no multipart parser) behind
  a per-user upload rate limit (60 uploads per 10 minutes, in memory).
- **Recording money.** Importing calls `transactions.recordLinked(caller, input, { claim, commit },
{ idempotencyKey: row.id })`, exactly like recurring payments (§16): the import module never writes
  transactions or balances. Lock order is the staged row, then the accounts (by ID). The approved
  reconciliation correction calls `transactions.reconcile` with the batch ID as idempotency key.
- **Receipts** (`modules/receipts`): `file-signature.ts` (JPEG, PNG, WebP, and PDF by magic bytes
  and structure; the declared type and the file-name extension must agree with the content) ·
  repository (per-transaction lock for the 10-receipt limit) · service · routes. Storage goes
  through `lib/file-storage.ts` (`FileStorage`: `put`, `read`, `remove`), whose local adapter keeps
  files under `RECEIPT_STORAGE_DIR` with random 32-hex keys, sharded by prefix, created
  exclusively (never overwritten) with owner-only permissions where the platform supports them,
  and refuses any key that is not 32 hex characters. Tests use an
  in-memory adapter. Files are served with `nosniff`, `Content-Security-Policy: default-src 'none';
img-src 'self'; sandbox`, `private, no-store`, and a sanitised `Content-Disposition`; PDFs are
  always attachments.
- **Limitations (documented, not hidden).** CSV only (no OFX/QFX, PDF, or bank connection); no
  malware scanning of receipts; the local storage adapter needs a persistent, private, backed-up
  volume (object storage is a later adapter); upload rate limits are per process; statements are
  never sent to any external service, AI or otherwise.

## 18. Notifications and automation (Phase 9)

A third deployable process, **`apps/worker`**, keeps people informed without them opening the app:
budget alerts, reminders for recurring payments and subscriptions, monthly summaries, and the
e-mails for all of them. Notifications describe money; they never record a transaction, change a
balance, or say a scheduled payment happened. The worker's recurring service is built with a ledger
that refuses every write (`LEDGER_REFUSES_WRITES`), so it _cannot_ record money even by mistake.

```text
 apps/api ── ledger write ──▶ automation_jobs (budget_evaluation, same DB transaction)
     │                              ▲                     notifications ──▶ notification_deliveries
     │ /api/v1/notifications        │ claim: FOR UPDATE SKIP LOCKED + lease          ▲          │ claim
     ▼                              │                                                │          ▼
 notification center ◀── notifications ◀── apps/worker: scheduler · jobs · e-mail ───┘    SMTP / Mailpit
```

**Nothing is generated or sent while no worker runs.** The API keeps working without one (events
and preferences are stored; the center shows what exists), and work waits in PostgreSQL until a
worker returns — within each job's expiry rules below. Settings → Notifications says whether a
worker has checked in during the last five minutes (`worker_heartbeats`). Production must run at
least one worker as a supervised, long-running process.

### Layout

| Piece                                | Responsibility                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `apps/worker/src/main.ts`            | Process shell: validated env, logger, Prisma, e-mail transport, signals, optional `/health`.      |
| `apps/worker/src/cli.ts`             | `status` (queue counts, recent workers) and `requeue-failed [id…]`.                               |
| `apps/api/src/automation/`           | The engine, exported once as `@calmcash/api/automation` (the worker's only import from the API).  |
| `apps/api/src/modules/notifications` | The center and preferences API; `notification-preferences.ts` is the one meaning of a preference. |
| `apps/api/src/lib/automation-events` | `recordBudgetsChanged`: the business event, written inside the ledger's transaction.              |
| `apps/api/src/config/email-env.ts`   | E-mail delivery rules shared by the API and the worker.                                           |

The engine reuses the API's own services — `BudgetsService.list` (ledger-backed spending),
`RecurringService.collect`/`occurrence` (the Phase 7 recurrence engine), and
`DashboardService.overview`/`categories` (Phase 6 cash flow) — through `automation/domain.ts`, so
an alert, a reminder, or a summary always agrees with the pages. No financial rule is copied.

### Business events, jobs, and scheduling

| Job kind            | Created by                                                                      | Does                                                      |
| ------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `budget_evaluation` | Every ledger write and every budget write, in the **same database transaction** | Re-checks all active budgets of that user                 |
| `daily_review`      | The scheduler, once per user and **local** calendar day                         | Reminders, monthly summary, budget re-check for that user |
| `maintenance`       | The scheduler, once per UTC day                                                 | Retention clean-up                                        |

- Ledger writes are every path that changes a transaction: create, edit, void, restore, bulk
  actions, recording a scheduled occurrence, statement imports, and reconciliation. A committed
  change cannot lose its event, and a rolled-back one leaves none (integration-tested with a refused
  write). Events coalesce: `coalesce_key` lets at most one re-check wait per user
  (`INSERT … ON CONFLICT DO NOTHING`); claiming clears it, so a change during a run queues exactly
  one more.
- A daily review is due at `WORKER_DAILY_REVIEW_HOUR` (08:00 by default) in the user's time zone and
  expires at their local midnight, computed with the shared zoned-time helpers (daylight saving
  included). Scheduled jobs have a permanent `dedupe_key` (`daily_review:<user>:<local date>`,
  `maintenance:<date>`), so overlapping ticks, restarts, and several workers enqueue each once.
  Ticks run every `WORKER_SCHEDULER_INTERVAL_MS`; the in-process timer only decides _when to look_ —
  everything durable is in the table, and the worker machine's time zone never matters.
- Payloads are versioned (`{ v: 1, … }`), carry identifiers and dates only, and are validated with
  shared Zod schemas when claimed. A job this deployment cannot read fails alone
  (`invalid_payload`, `unknown_kind`); the worker keeps running.

### Claims, leases, retries, and recovery

- **Claiming:** one statement per batch — the oldest due `pending` rows
  `FOR UPDATE SKIP LOCKED`, feeding an `UPDATE` that sets `processing`, the lease (`locked_by`,
  `locked_until`), and `attempts + 1`. Concurrent workers never claim the same row (integration
  test: three workers, 40 jobs, 40 distinct claims). Batches are bounded (`WORKER_BATCH_SIZE`); a
  full batch makes the next cycle start at once.
- **No transaction is held while working.** The claim commits first; jobs and SMTP calls run
  afterwards; completion is a separate, **fenced** update (`WHERE locked_by = <this worker> AND
status = processing`) — a worker whose lease was recovered can no longer change the row.
- **Crash recovery:** each cycle returns rows whose lease expired to `pending` (or `failed` when
  out of attempts) with `last_error_code = lease_expired`. An e-mail recovered this way is flagged
  `outcome_uncertain` (the crashed worker may have sent it).
- **Retries:** jobs retry after 30 s, 2 min, 8 min, 32 min, then hourly (5 attempts); e-mail after
  1, 4, 16, 64 min, then every 3 h (5 attempts) — never past the delivery's expiry. Permanent
  failures stop at once. Failed rows keep their sanitised `last_error_code` (`internal`,
  `prisma_p2002`, `smtp_4xx`, `recipient_rejected`, …; never a message, which could contain data)
  for diagnosis. `pnpm worker:status` shows the counts; `requeue-failed` retries failed jobs once
  the cause is fixed.
- **Expiry:** waiting jobs past `expires_at` become `expired` and never run. A stopped worker
  therefore never replays missed days: yesterday's review expired at midnight, and today's review
  catches up on whatever is still relevant.

### Notification identity and catch-up rules

Every notification is unique per user and `dedupe_key`; creation is
`INSERT … ON CONFLICT DO NOTHING`, so repeated or concurrent jobs never create a second record.

| Notification            | Identity (`dedupe_key`)                                     | When                                                           | Catch-up and suppression                                                                      |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Budget approaching      | `budget:<budget>:<period start>:<limit>:<level bp>`         | Spending ≥ one of the budget's `alert_thresholds_bp`           | Current period only; archived budgets never alert; e-mail expires at period end (≤ 2 days)    |
| Budget limit reached    | Same, level `10000`                                         | Spending ≥ the limit (the text says how far over)              | As above                                                                                      |
| Upcoming payment        | `recurring-upcoming:<schedule>:<scheduled>:<due>:L<lead>`   | Due date 1…lead days away (lead 1, 3, or 7)                    | Never sent once due; another lead time's identity for the same due date covers it             |
| Payment due today       | `recurring-due:<schedule>:<scheduled>:<due>`                | On the due date                                                | E-mail expires at the end of that day                                                         |
| Overdue payment         | `recurring-overdue:<schedule>:<scheduled>:<due>`            | Once, within 7 days after the due date                         | Older occurrences are left alone; e-mail expires after 2 days                                 |
| Subscription renewal    | `subscription-renewal:<schedule>:<scheduled>:<due>:L<lead>` | Renewal 1…lead days away                                       | Subscriptions get only this reminder (no bill, due, or overdue one); none once cancelled      |
| Monthly summary         | `summary:<YYYY-MM>:<currency>`                              | First 7 days of the next month, one per currency with activity | Later, the month is left alone; e-mail figures are recomputed when sent; expires after 7 days |
| E-mail delivery problem | `delivery-problem:<UTC date>`                               | A notification e-mail failed for good                          | In-app only, at most one per day                                                              |

- **Budgets:** each level alerts once per budget, period, and limit. A level already notified — or
  a higher one — covers it: a void that drops spending below 80 % followed by a restore does not
  alert again, and one expense that jumps from 50 % to 110 % creates one alert (the limit). A new
  period, a changed limit, or a new threshold is a new identity. Comparisons are exact (`bigint`),
  so 79.996 % has not reached 80 %. Currency, period, partial first period, time zone, category
  roll-up, expense-only semantics, and the exclusion of transfers, adjustments, and voided rows all
  come from the budget engine. An alert never blocks recording an expense.
- **Reminders** use only pending occurrences of active schedules (the recurring service's own
  `collect`): recorded, skipped, paused, cancelled, archived, and ended ones never qualify. A
  postponed occurrence has a new due date and therefore a new identity. Expected income is
  reminded about only when the person opts in. A review creates at most 25 new reminders, most
  urgent first.
- **Monthly summaries** cover the previous calendar month in the user's time zone from the
  dashboard's cash-flow figures (actual income and spending only), with the savings rate
  "not available" when there was no income, the leading categories, monthly budget statuses, and —
  separately, labelled as plans — the payments still expected in the next 30 days. A month with no
  income or spending in a currency gets no summary. Nothing is sent to any AI service.
- **Before every e-mail** the worker re-checks: address verified, e-mail still on for the type, not
  expired, and the subject unchanged (budget active in that period; occurrence still pending, on
  the same due date, of an active, uncancelled schedule). Otherwise the delivery is `suppressed`
  with a reason (`preference_off`, `email_unverified`, `occurrence_resolved`,
  `occurrence_rescheduled`, `budget_archived`, `expired`, …) — never sent late or out of date.
  Turning e-mail off for a category also suppresses its queued e-mails immediately, keeping the
  in-app history.

### E-mail delivery and its limits

E-mail goes through the Phase 3 `EmailService` (`createSmtpEmailService`); there is no second mail
subsystem, and no request handler sends notification e-mail. Delivery is **at least once, not
exactly once**: SMTP can accept a message and lose the connection before confirming it. nodemailer
cannot tell that apart from a failure before the data was sent, so dropped connections are
classified `ambiguous`, recorded with `outcome_uncertain = true`, and retried with the **same
Message-ID** (`<delivery id>.notification@<web host>`), which lets mail systems that de-duplicate by
Message-ID drop the copy. A duplicate e-mail remains possible in that case; a silently lost one does
not. In-app notifications are exactly once per identity.

Subjects are generic ("Budget alert from CalmCash") — no names, amounts, or descriptions — and
every interpolated value in the HTML is escaped. Each e-mail links to the related page (which still
requires signing in) and to Settings → Notifications, where e-mail is switched off.

**Delivery mode is explicit** (`EMAIL_DELIVERY_MODE`, validated identically by the API and the
worker): `mailpit` (default outside production) allows only a local Mailpit host and no
credentials; `smtp` is refused unless `NODE_ENV=production`; `disabled` sends nothing. A
development or test environment holding real mail credentials therefore refuses to start, and
`createSmtpEmailService` re-checks the rule when it builds the transport. Tests inject an in-memory
service and never open an SMTP connection.

### Notification center API

All routes require a session; changes require the CSRF token; responses are `no-store`; the owner
is always the session's user (another user's notification answers exactly like a missing one).

| Method & path                            | Purpose                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `GET /notifications`                     | Newest first; `status=all\|unread`, `page`, `pageSize` (≤ 50)              |
| `GET /notifications/unread-count`        | Unread notifications in the center                                         |
| `POST /notifications/read`               | Mark ≤ 100 IDs read                                                        |
| `POST /notifications/read-all`           | Mark all read                                                              |
| `POST /notifications/:id/read`           | Mark one read (idempotent)                                                 |
| `POST /notifications/:id/dismiss`        | Hide one from the center (idempotent; kept for its identity)               |
| `GET`/`PATCH /notifications/preferences` | Channels per category, lead times, income opt-in, e-mail and worker status |

Notifications are plain text plus a target made of identifiers (`budget`, `recurring`,
`subscription`, `dashboard`, `notification_settings`); the shared `notificationLocation` turns a
target into an in-app path for both the web app and e-mails, so a stored notification can never
link elsewhere.

### Preferences and defaults

No row means the defaults: every category in the app, nothing by e-mail, 3 days' notice for bills
and subscriptions, expected income not reminded. In-app and e-mail are independent per category;
turning one off never turns another on; a type with both off is not generated at all (a type with
e-mail only is stored with `in_app = false`, hidden from the center). E-mail is sent only to a
verified address. Changes take effect for the next job and delivery; concurrent saves are
serialised by a per-user lock.

### Operations

```bash
pnpm dev                          # API, web, and worker together
pnpm dev:worker                   # worker only (watch mode)
pnpm build && pnpm worker:start   # production bundle: node apps/worker/dist/main.js
pnpm worker:status                # queue counts and recently seen workers
pnpm --filter @calmcash/worker requeue-failed [job-id …]
```

- Run one or more workers next to the API, supervised (systemd, a container restart policy, a
  platform worker process). Several workers coordinate through row locks and unique keys; clocks
  should be NTP-synchronised, because leases and `run_at` use the worker's clock.
- `WORKER_HEALTH_PORT` serves `GET /health` (loopback by default): `200` while cycles complete,
  `503 stalled` when they stop or fail. Graceful shutdown finishes the current cycle within
  `SHUTDOWN_TIMEOUT_MS`; anything cut off is recovered through its lease.
- Logs are structured JSON with job and delivery IDs, kinds, attempts, outcomes, and error codes —
  never addresses, names, descriptions, amounts, or message content (integration-tested).
- Retention (daily `maintenance`): notifications 400 days (longer than any period an identity can
  still be evaluated in, so a deleted identity is not re-created while relevant — the exception is
  a single custom budget period longer than that), finished deliveries 90 days, finished jobs
  30 days, heartbeats of workers gone for 7 days.

### Known limitations

- Reminders are considered once per local day (by default at 08:00); a schedule created after that
  is first considered the next morning. Budget alerts follow writes within a poll interval.
- No push, SMS, or browser notifications; no bank-detected renewals (subscriptions are what the
  person entered); notifications are not security or fraud alerts.
- E-mail is at least once (see above). Leases and schedules depend on reasonably synchronised
  worker clocks. The upload and authentication rate limits remain per API process.
