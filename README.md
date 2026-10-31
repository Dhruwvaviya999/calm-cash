# CalmCash

CalmCash is an AI-powered personal finance tracker. The roadmap covers transaction management,
budgeting, bank statement imports, financial analytics, AI insights, and recurring payments.

> **Status — Phase 9 (notifications, reminders, and background automation) complete.** On top of
> Phases 1–8 (foundation, design system, authentication, accounts, transactions, dashboard,
> budgets and planning, statement imports and receipts), a background worker (`apps/worker`) keeps
> people informed: budget alerts at each budget's own thresholds, reminders before and on the due
> date of recurring bills (and expected income, if chosen), one overdue reminder, subscription
> renewal reminders, and a monthly summary per currency — in an in-app notification center and,
> when someone opts in, by e-mail. Work is durable in PostgreSQL (claimed with `SKIP LOCKED`
> leases, retried, never duplicated), and notifications never record or move money. Nothing new is
> generated while no worker runs. E-mail is at least once, not exactly once; outside production it
> can only reach the local Mailpit. Push, SMS, and browser notifications are not part of this phase.

## Tech stack

| Layer       | Technology                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Web         | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, shadcn/ui (Radix), Recharts, Lucide, Geist |
| API         | Node.js 24, Express 5, pino, Helmet                                                                      |
| Data        | PostgreSQL 18, Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`)                               |
| Auth        | Server-side sessions in PostgreSQL, HttpOnly cookies, CSRF tokens, Argon2id, express-rate-limit          |
| E-mail      | nodemailer over SMTP; Mailpit catches mail locally                                                       |
| Contracts   | TypeScript 6 (strict), Zod 4 — shared by web and API via `@calmcash/shared`                              |
| Tooling     | pnpm 11 workspaces, Vitest 5, Supertest, Testing Library + jsdom, ESLint 9 + typescript-eslint, Prettier |
| Worker      | Node.js 24 process; PostgreSQL job tables (`FOR UPDATE SKIP LOCKED`, leases) — no Redis                  |
| Local infra | Docker Compose (PostgreSQL, Mailpit)                                                                     |

## Repository structure

```text
calmcash/
├── apps/
│   ├── api/                 Express REST API (TypeScript)
│   │   └── src/
│   │       ├── app.ts       App factory (middleware, routes, error handling)
│   │       ├── server.ts    Entry point (env validation, listen, graceful shutdown)
│   │       ├── config/      Validated environment configuration
│   │       ├── lib/         Database client, logger, errors, request IDs, shutdown
│   │       ├── middleware/  Request logging, validation, 404, error handler
│   │       ├── modules/     Feature modules (health, auth, accounts, transactions, categories, tags,
│   │       │                dashboard, budgets, recurring, subscriptions, goals, imports,
│   │       │                receipts, notifications)
│   │       ├── automation/  Worker engine: jobs, scheduler, alerts, reminders, summaries, e-mail
│   │       └── routes/      Versioned routers (/api/v1)
│   ├── worker/              Background worker process (TypeScript): main.ts, cli.ts, health
│   └── web/                 Next.js web app (TypeScript)
│       └── src/
│           ├── app/         Routes: (app) group with the shared shell, boundaries
│           ├── components/  Design system: ui primitives, layout, feedback, finance, forms, charts
│           ├── features/    Feature modules (dashboard, transactions, budgets, recurring, goals, …)
│           ├── hooks/       Reusable React hooks
│           ├── lib/         Env, API client, navigation, formatting, preferences
│           ├── services/    Typed API endpoint functions
│           └── types/       Web-only types
├── packages/
│   └── shared/              DTO types, Zod schemas, constants, money, periods, ratios, recurrence
├── prisma/
│   ├── schema.prisma        Database schema
│   └── migrations/          Versioned SQL migrations
├── docs/                    Architecture, UI architecture, database design, development guide
├── compose.yaml             Local PostgreSQL and Mailpit
├── prisma.config.ts         Prisma CLI configuration
├── eslint.config.mjs        Workspace lint rules
├── tsconfig.base.json       Shared strict TypeScript settings
└── .env.example             Backend/database environment template
```

## Quick start

Prerequisites: **Node.js 24 LTS**, **pnpm 11** (`corepack enable`), and **Docker** with Compose v2.
See the [development guide](docs/development-guide.md#1-prerequisites) for details.

```bash
pnpm install                                     # installs deps and generates the Prisma Client
cp .env.example .env                             # backend + database settings
cp apps/web/.env.example apps/web/.env.local     # web settings
pnpm db:up                                       # start PostgreSQL (localhost:5433)
pnpm mail:up                                     # start Mailpit (SMTP :1025, inbox :8025)
pnpm db:migrate                                  # apply migrations
pnpm dev                                         # API on :4000, web on :3000, and the worker
```

Open <http://localhost:3000> — signed-out visitors land on the sign-in page. Create an account at
<http://localhost:3000/register>, open the confirmation e-mail in Mailpit at
<http://localhost:8025>, follow the link, and sign in. Phones get a bottom navigation bar, tablets an
icon rail, and desktops a collapsible sidebar. **Settings** holds your profile, password, signed-in
devices, and **About and diagnostics**, which should show the API as **Online** and the database
as **Connected**. The API health endpoints are
[`/api/v1/health`](http://localhost:4000/api/v1/health) and
[`/api/v1/health/ready`](http://localhost:4000/api/v1/health/ready).

## Scripts

| Script                  | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `pnpm dev`              | Start the API, the web app, and the worker in watch mode.  |
| `pnpm dev:worker`       | Start only the background worker (watch mode).             |
| `pnpm worker:start`     | Run the built worker (production).                         |
| `pnpm worker:status`    | Show job and e-mail queue counts and recent workers.       |
| `pnpm build`            | Build the API and worker bundles and the Next.js build.    |
| `pnpm lint`             | Lint the whole workspace (warnings fail).                  |
| `pnpm typecheck`        | Type-check every package.                                  |
| `pnpm test`             | Run all unit and component test suites (no database).      |
| `pnpm test:integration` | Run the API integration tests against `TEST_DATABASE_URL`. |
| `pnpm format`           | Format with Prettier.                                      |
| `pnpm format:check`     | Check formatting.                                          |
| `pnpm db:up`            | Start local PostgreSQL (Docker).                           |
| `pnpm mail:up`          | Start Mailpit, the local e-mail catcher (Docker).          |
| `pnpm db:down`          | Stop local services (data is kept).                        |
| `pnpm db:generate`      | Generate the Prisma Client.                                |
| `pnpm db:migrate`       | Create/apply migrations in development.                    |
| `pnpm db:deploy`        | Apply pending migrations (CI/production).                  |
| `pnpm db:studio`        | Open Prisma Studio.                                        |

## Documentation

- [Architecture](docs/architecture.md) — boundaries, communication, module layout, error handling,
  configuration, technology decisions.
- [UI architecture](docs/ui-architecture.md) — visual identity, design tokens, the responsive
  shell, components, prototype-data rules, accessibility.
- [Authentication and security](docs/authentication.md) — sessions, cookies, CSRF, passwords,
  e-mail tokens, rate limits, deployment model, configuration.
- [Database design](docs/database-design.md) — model relationships, money representation, balance
  rules, transactions, categories, tags, locking, dashboard metrics, budgets, recurrence, goals,
  statement imports (duplicate rules, idempotency, reconciliation), receipts, constraints,
  migrations.
- [Development guide](docs/development-guide.md) — setup, commands, testing, conventions,
  troubleshooting.

## Engineering principles

- **TypeScript everywhere, strictly.** No `any`, no unchecked type assertions, explicit types at
  module boundaries.
- **Validate untrusted data at runtime.** Zod at the API edge, on API responses in the client,
  and for environment variables. Database constraints back up both.
- **Money is exact.** Integer minor units in `BIGINT`, `bigint` in code, decimal strings in JSON.
  Never floating point.
- **Decoupled features.** Each feature is a module with explicit dependencies; shared contracts
  live in one package.
