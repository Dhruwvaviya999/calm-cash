# CalmCash architecture

This document describes how the CalmCash codebase is organised, how its parts communicate, and the
rules that keep features decoupled as the product grows. It reflects the Phase 1 foundation and the
Phase 3 authentication layer (detailed in [authentication.md](./authentication.md)).

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
    lib/                   Cross-cutting infrastructure (errors, logging, DB client, e-mail, background tasks, shutdown, …)
    middleware/            Request logging, origin check, validation convention, 404, error handler
    modules/<feature>/     Feature modules (routes → controller → service → repository): health, auth
    testing/               Test app factories, in-memory e-mail, integration-database harness
    routes/v1.ts           Composition root of API v1: mounts every module router
    generated/prisma/      Generated Prisma Client (git-ignored; `pnpm db:generate`)
  web/src/
    app/                   Routes only: root layout, (app) route group with the shell, boundaries
    features/<feature>/    Feature modules: components and view logic for one capability
    components/            Feature-agnostic design system (see docs/ui-architecture.md)
      ui/                  shadcn/ui primitives (owned source)
      brand/ layout/ theme/ feedback/ finance/ forms/
    fixtures/              Prototype-only sample data (never imported by shared code)
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
  adds the in-memory CSRF token as `x-csrf-token` on state-changing requests. A `401 UNAUTHORIZED`
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
  an `AccountService`-shaped dependency through the composition root.
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
- **Authentication (Phase 3, done):** see [authentication.md](./authentication.md). Future modules
  get the caller only through `getAuthContext(req)` after `requireSession` (and `requireCsrf` for
  mutations) and must scope every query by that user ID.
