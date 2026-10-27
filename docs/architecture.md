# CalmCash architecture

This document describes how the CalmCash codebase is organised, how its parts communicate, and the
rules that keep features decoupled as the product grows. It reflects the Phase 1 foundation, the
Phase 3 authentication layer (detailed in [authentication.md](./authentication.md)), the Phase 4
accounts module, the Phase 5 transactions, categories, and tags modules, the Phase 6 dashboard, and
the Phase 7 planning modules (budgets, recurring schedules, subscriptions, savings goals).

## 1. Overview

CalmCash is a pnpm monorepo with two deployable applications and one shared library:

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

| Path                | Responsibility                                                                    |
| ------------------- | --------------------------------------------------------------------------------- |
| `apps/web`          | User interface. Talks to the API over HTTP only — never to the database.          |
| `apps/api`          | The only process with database access. Owns validation and business rules.        |
| `packages/shared`   | Isomorphic contracts used by both apps: DTO types, Zod schemas, constants, money. |
| `prisma/`           | Database schema and versioned SQL migrations.                                     |
| `prisma.config.ts`  | Prisma CLI configuration (schema path, migrations path, connection URL).          |
| `compose.yaml`      | Local PostgreSQL and the Mailpit e-mail catcher for development.                  |
| `eslint.config.mjs` | One lint configuration for the whole workspace.                                   |

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
                           subscriptions, goals
    testing/               Test app factories, in-memory e-mail, integration-database harness
    routes/v1.ts           Composition root of API v1: mounts every module router
    generated/prisma/      Generated Prisma Client (git-ignored; `pnpm db:generate`)
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

| Variable                                | Used by           | Purpose                                    | Default                      |
| --------------------------------------- | ----------------- | ------------------------------------------ | ---------------------------- |
| `POSTGRES_USER`                         | Docker Compose    | Local database user                        | —                            |
| `POSTGRES_PASSWORD`                     | Docker Compose    | Local database password                    | —                            |
| `POSTGRES_DB`                           | Docker Compose    | Local database name                        | —                            |
| `POSTGRES_PORT`                         | Docker Compose    | Host port of the container (loopback only) | `5433`                       |
| `DATABASE_URL`                          | Prisma CLI, API   | PostgreSQL connection URL                  | — (required)                 |
| `NODE_ENV`                              | API               | `development` \| `test` \| `production`    | `development`                |
| `API_HOST`                              | API               | Bind address                               | `localhost`                  |
| `API_PORT`                              | API               | Port                                       | `4000`                       |
| `CORS_ORIGINS`                          | API               | Comma-separated browser origins            | — (required)                 |
| `JSON_BODY_LIMIT`                       | API               | Max JSON body size                         | `100kb`                      |
| `LOG_LEVEL`                             | API               | pino level                                 | `info`                       |
| `SHUTDOWN_TIMEOUT_MS`                   | API               | Grace period for in-flight requests        | `10000`                      |
| `WEB_APP_URL`                           | API               | Web origin used in e-mailed links          | 1st CORS origin              |
| `TRUST_PROXY_HOPS`                      | API               | Trusted reverse proxies (client IPs)       | `0`                          |
| `SESSION_MAX_AGE_DAYS`                  | API               | Absolute session lifetime                  | `14`                         |
| `SESSION_IDLE_TIMEOUT_HOURS`            | API               | Idle timeout of a session                  | `72`                         |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | API               | SMTP server (Mailpit locally)              | `localhost`, `1025`, `false` |
| `SMTP_USER`, `SMTP_PASSWORD`            | API               | SMTP credentials (both or neither)         | none                         |
| `EMAIL_FROM`                            | API               | Sender of transactional e-mail             | local placeholder            |
| `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`  | Docker Compose    | Mailpit host ports                         | `1025`, `8025`               |
| `TEST_DATABASE_URL`                     | Integration tests | Disposable `*_test` database               | — (tests only)               |
| `NEXT_PUBLIC_API_URL`                   | Web (build time)  | API origin, without `/api/v1`              | — (required)                 |

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

| Decision                                      | Rationale                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| TypeScript 6.0                                | Latest JS-API release. TS 7 (native) is not yet supported by `typescript-eslint` (`<6.1`).              |
| ESLint 9.39                                   | `eslint-config-next` 16.4 and its React/import/a11y plugins target ESLint 9; v10 is not yet supported.  |
| Prisma 7.10 (stable)                          | npm's `latest` tag currently points at an 8.0 release candidate; prereleases are avoided.               |
| Prisma `prisma-client` + `@prisma/adapter-pg` | Rust-free client generated as TypeScript, bundle-friendly, pg connection pooling.                       |
| Express 5                                     | Native async error propagation; stable.                                                                 |
| Next.js 16 + Turbopack                        | Default bundler; Tailwind CSS v4 runs as a Turbopack loader (`@tailwindcss/turbopack`).                 |
| `node --watch --import tsx` for API dev       | Node's built-in watcher works reliably under `pnpm --parallel`; tsx's own watcher did not on Windows.   |
| Shared package as TypeScript source           | No stale build output; one strict type-check; bundled into the API by tsup.                             |
| PostgreSQL 18 (Docker)                        | Current stable major; port 5433 avoids clashing with a native install.                                  |
| Money as BIGINT minor units                   | Exact integer arithmetic; serialised as strings in JSON. See the database design.                       |
| shadcn/ui primitives (new-york, Radix)        | Accessible, owned component source; restyled through CalmCash tokens.                                   |
| `clsx` + `tailwind-merge` for `cn`            | Stable, established helper; the shadcn v4 CLI's `cn` package is pre-1.0.                                |
| Custom theme/sidebar preference store         | Pre-paint inline script per the Next.js guide; avoids `next-themes`' client-rendered script warning.    |
| Geist via the `geist` package                 | Fonts bundled from npm with `next/font/local`; builds never fetch fonts.                                |
| Opaque sessions in PostgreSQL (no JWT)        | Instant revocation, server-side expiry, nothing secret readable by scripts; one database round trip.    |
| `argon2` (node-argon2) for Argon2id           | Reference C implementation with bundled N-API prebuilds (`allowBuilds` only compiles as a fallback).    |
| HMAC-derived CSRF token, hash stored          | Synchronizer token bound to the session that survives page reloads without storing it in clear.         |
| `express-rate-limit` (memory store)           | Maintained, typed, standard headers; swap the store for Redis before running several instances.         |
| nodemailer (`~10.0`) + Mailpit                | Provider-neutral SMTP behind a small `EmailService` interface; Mailpit keeps local mail on the machine. |
| Testing Library + jsdom (per-file opt-in)     | Real interaction tests for forms and guards; static-markup tests stay in plain Node.                    |

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
- **Later phases** build on the same ledger: statement imports will add a source and a
  deduplication fingerprint per row (see the database design); notifications (Phase 9) can deliver
  the budget alerts and due payments that Phase 7 only shows in the app.

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
  `calendarDateInTimeZone(now(), caller.timeZone)`. No background job exists: due and overdue
  states are calculated on each request from persisted rules, so nothing depends on a scheduler.
