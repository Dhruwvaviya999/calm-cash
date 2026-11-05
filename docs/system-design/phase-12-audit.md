# Phase 12 — production-readiness audit and plan

Audit date: 2026-11-04. Branch: `phase-12-production-readiness` (from `main` at `a4a0ace`).
This file records what the audit found **before** any Phase 12 change, and the plan that followed.
The outcome of each item is tracked in [production-readiness.md](production-readiness.md).

## 1. Repository state

- `main` was clean and equal to `calm-cash/main`. Phase 11 is committed (`a4a0ace`) and pushed, so
  no uncommitted work had to be preserved. `calm-cash/development` is behind `main`; a remote
  bot branch (`vercel/install-vercel-speed-insights-…`) is unmerged and out of scope.
- Workspace: `apps/api` (Express 5), `apps/web` (Next.js 16.4.3), `apps/worker`, `packages/shared`,
  Prisma 7.10.1 with `@prisma/adapter-pg`, PostgreSQL 18 locally, ten migrations.
- Deployment model already chosen by the repository: **Vercel Services** (`vercel.json`) — `web`
  (Next.js) and `api` (Express as a Vercel Function) on **one origin** (`/api/*` rewrite), plus the
  worker as a Vercel **daemon** built from `Dockerfile.worker`. Receipts use **private Vercel Blob**
  on Vercel (`RECEIPT_STORAGE_PROVIDER=vercel-blob`) and a private directory locally. Neon is the
  intended PostgreSQL provider. `AI_ENABLED=false` is documented for Vercel.

## 2. Findings

Severity: **H** fix before production · **M** fix in this phase · **L** document / later.

| #   | Area         | Finding                                                                                                                                                                                                                                                                           | Sev |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| F1  | Rate limits  | Every limiter (auth, uploads, AI, intelligence) uses `express-rate-limit`'s in-memory store. On Vercel Functions each instance — and each cold start — has its own counters, so sign-in and recovery limits are neither shared nor durable.                                       | H   |
| F2  | Local config | The developer `.env` sets `TEST_DATABASE_URL` to the same Neon database as `DATABASE_URL`. The integration guard (`*_test` name, distinct from `DATABASE_URL`) refuses it, so nothing is wiped, but the value is wrong. Not changed by this phase (local file); runs override it. | M   |
| F3  | PWA          | No manifest, no PNG/maskable/Apple icons, no service worker, no offline page, no install entry point. Only `app/icon.svg` (the brand mark) exists.                                                                                                                                | M   |
| F4  | Web headers  | The web app sends no CSP, HSTS, frame, `nosniff`, or permissions headers (only `Referrer-Policy` on two token pages). The API has Helmet defaults.                                                                                                                                | M   |
| F5  | CI/CD        | No `.github/workflows`. Nothing runs lint, types, tests, migrations, or builds on push.                                                                                                                                                                                           | H   |
| F6  | Formatting   | `.prettierignore` does not exclude the vendored skill folders (`.agents/`, `.claude/skills/`, `.windsurf/`, tracked by `skills-lock.json`), so `format:check` fails on third-party files.                                                                                         | L   |
| F7  | Worker       | `stop()` waits for the whole claimed batch (up to 20 jobs + 20 e-mails) and does not check for shutdown between items, so SIGTERM can exceed `SHUTDOWN_TIMEOUT_MS`; unstarted claims then wait for lease expiry instead of being released. Never tested with real signals.        | M   |
| F8  | Containers   | Only `Dockerfile.worker`; it copies the whole build stage (all dev dependencies and sources) into the runtime image and has no `HEALTHCHECK` or init process. No API image for non-Vercel hosts.                                                                                  | M   |
| F9  | Receipts     | A crash between writing a file and inserting its row (or a failed delete) leaves an unreferenced file; nothing finds or removes it, and nothing finds rows whose file is missing.                                                                                                 | M   |
| F10 | Readiness    | `/health/ready` checks only PostgreSQL. Worker heartbeat age, receipt storage, and e-mail configuration are not reported anywhere an operator can query safely.                                                                                                                   | M   |
| F11 | Phase 11 (A) | An occurrence paid through an ordinary transaction cannot be linked to that transaction; it stays overdue and the payment also counts as everyday spending in forecasts.                                                                                                          | M   |
| F12 | Phase 11 (B) | pg 8.23 deprecation: "client.query() when the client is already executing a query". Source to be traced.                                                                                                                                                                          | L   |
| F13 | Dependencies | `pnpm audit`: nodemailer < 10.1.4 (3 × moderate, direct, address parser), zod < 4.6.6 (high, transitive via `@vercel/blob`/`@vercel/functions` → `@vercel/cli-config`), minimatch < 11.0.1 (moderate, ESLint only).                                                               | M   |
| F14 | Data export  | No user-accessible export of their own records. No account deletion (correctly — it needs a full mapping first).                                                                                                                                                                  | M   |
| F15 | Backups      | No backup/restore procedure or drill; receipts are not part of any backup story.                                                                                                                                                                                                  | M   |
| F16 | Docs         | Rich per-phase docs exist (`architecture.md`, `database-design.md`, …) but no system-level overview with diagrams, ADRs, runbooks, environment inventory, or DR plan.                                                                                                             | M   |
| F17 | Lint memory  | Root `eslint .` type-checks all packages in one process and needs a raised heap on 8 GB machines.                                                                                                                                                                                 | L   |

Verified as already sound (kept as is): Argon2id hashing; opaque random session tokens stored as
hashes; HttpOnly, Secure, `__Host-` cookie in production with `SameSite=Strict`; idle and absolute
expiry; CSRF token on unsafe methods plus an `Origin` allowlist; explicit CORS allowlist with
credentials (no wildcard); `no-store` on every authenticated router; Zod on every request and on
environment; parameterised `$queryRaw` tagged templates; private receipt storage with random keys,
path-traversal checks, content signatures, and authenticated streaming; graceful API shutdown;
production env checks (HTTPS origins, persistent receipt storage, no local storage on Vercel);
`BIGINT` minor units; `FOR UPDATE` row locks for ledger writes; idempotency keys on transaction
creation; PostgreSQL job queue with `SKIP LOCKED` and leases; an e-mail guard that refuses external
SMTP outside production.

## 3. Plan (in order)

1. **Shared rate limits (F1).** A PostgreSQL `Store` for `express-rate-limit`: one table, atomic
   `INSERT … ON CONFLICT` fixed windows, hashed keys (no e-mail addresses at rest), cleanup by the
   worker's maintenance job. Every existing limiter keeps its rules, headers, and messages.
2. **Phase 11 issues (F11, F12, F6, F17).** Link an existing transaction to an occurrence (API, UI,
   tests); trace and fix the pg warning; ignore vendored skills in Prettier; document lint memory.
3. **Worker shutdown (F7).** Check for shutdown between items, release unstarted claims, test
   SIGTERM/SIGINT against a real process in a Linux container.
4. **PWA (F3) and web headers (F4).** Manifest, generated icons from the brand mark, a hand-written
   service worker that caches only versioned static assets and an offline page, install entry
   point, safe update prompt; CSP (without nonces, so pages stay static) and security headers.
5. **Readiness and storage (F9, F10).** Protected operational status; receipt storage audit and
   orphan cleanup with a grace period (operator command, dry run by default).
6. **Data export (F14).** Authenticated JSON export of the person's own records, streamed, no
   stored file. Account deletion documented as a production prerequisite.
7. **Dependencies (F13).** Smallest compatible fixes; document what remains.
8. **Packaging and CI (F5, F8).** API Dockerfile, slimmer worker image, CI workflow with a
   PostgreSQL service and Mailpit-free fake e-mail, manual-approval deploy/migration workflow.
9. **Backups (F15).** Restore drill script against an isolated database, receipt reconciliation.
10. **Verification.** Lint, types, unit and integration tests, builds, container signal tests,
    `EXPLAIN ANALYZE`, a bounded local load test, and real-browser checks (Chromium; other engines
    only if actually available).
11. **Documentation (F16).** `docs/system-design/` index, diagrams, ADRs, deployment, runbooks,
    environment inventory, performance and DR — linking to the existing detailed docs rather than
    copying them.

Not in scope: new financial features, an external AI provider, Redis, paid services, applying the
Phase 11 migration to Neon, DNS or production environment changes, commits or pushes.
