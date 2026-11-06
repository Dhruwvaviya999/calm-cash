# Production readiness — Phase 12 outcome

Status as of 2026-11-05 on branch `phase-12-production-readiness` (uncommitted). The audit that
started the phase is [phase-12-audit.md](phase-12-audit.md).

## What changed

| Finding                          | Change                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 per-process rate limits       | PostgreSQL store for every limiter (`lib/rate-limit.ts`, migration `20261104090000_shared_rate_limits`), hashed keys, worker cleanup                                                                                            | integration tests: 40 concurrent hits count 1…40 exactly; three app instances share one sign-in limit; window reset; no readable keys                                                                     |
| F3 no PWA                        | manifest, icons from the brand mark, `public/sw.js`, `/sw-version.js`, `/offline`, connection banner, update notice, Settings › Install                                                                                         | Chromium: SW controls pages; caches hold only hashed assets + `/offline` (0 `/api` entries); offline page with server stopped; retry; update notice → "Reload now" → new version, old shell cache removed |
| F4 web headers                   | CSP (no nonces), HSTS, nosniff, frame denial, referrer, permissions, COOP                                                                                                                                                       | Chromium: 0 console/CSP errors over 11 pages × 8 widths × 2 themes                                                                                                                                        |
| F5 no CI                         | `.github/workflows/ci.yml` (PostgreSQL service, migrations, schema drift check, format, lint, types, unit, integration, build, artefact check, images); `database-migrate.yml` (manual, environment-gated, backup confirmation) | workflow files only — **not yet run on GitHub**                                                                                                                                                           |
| F6 formatting                    | vendored skills excluded in `.prettierignore`                                                                                                                                                                                   | `pnpm format:check` passes                                                                                                                                                                                |
| F7 worker shutdown               | stop between items; release unstarted claims; tests                                                                                                                                                                             | Linux containers: SIGTERM/SIGINT → exit 0 in < 0.7 s, 0 rows left `processing`, 0 released rows with a used attempt                                                                                       |
| F8 containers                    | `Dockerfile.api` (new), `Dockerfile.worker` (prod-only deps, non-root, HEALTHCHECK, shared pnpm caches)                                                                                                                         | both build; run as uid 1000; argon2 loads; health checks pass                                                                                                                                             |
| F9 orphan receipts               | `FileStorage.list()` (local, Blob, memory) + audit with 24 h grace, re-check before delete; `receipts:audit`                                                                                                                    | integration tests incl. failing storage and foreign files; restore drill 5/5 files                                                                                                                        |
| F10 readiness                    | `GET /health/status` (bearer `OPS_STATUS_TOKEN`): DB latency, worker heartbeat, queues, providers                                                                                                                               | integration tests: degraded ≠ down, token in constant time, 404 otherwise, no secrets in body                                                                                                             |
| F11 Phase 11 A (double counting) | link an existing transaction to an occurrence (API + "Already recorded this payment?" UI)                                                                                                                                       | 8 integration tests (idempotency, refusals, concurrency, ranking, forecast flag) + planning component test + Chromium flow                                                                                |
| F12 Phase 11 B (pg warning)      | traced to Prisma 7.10 loading three `include` relations concurrently on the one connection of a batch `$transaction` in the transactions page query; replaced by two pool queries                                               | warning gone in all suites                                                                                                                                                                                |
| F13 dependencies                 | nodemailer ~10.1.7; pnpm override for transitive zod                                                                                                                                                                            | `pnpm audit`: 1 moderate left (minimatch, ESLint only)                                                                                                                                                    |
| F14 export                       | `GET /api/v1/exports/financial-data` + Settings › Your data                                                                                                                                                                     | integration tests (exact amounts, no secrets, other users excluded, 401, 429); Chromium download                                                                                                          |
| F15 backups                      | `scripts/restore-drill.sh`                                                                                                                                                                                                      | drill passed: 14/14 checks, 392 constraints valid                                                                                                                                                         |
| F16 docs                         | `docs/system-design/` (14 diagrams, 9 ADRs, runbooks, env inventory)                                                                                                                                                            | this folder                                                                                                                                                                                               |
| F17 lint memory                  | root lint pinned to a 4 GB heap (measured ~70–95 s on 8 GB RAM)                                                                                                                                                                 | `pnpm lint` passes                                                                                                                                                                                        |
| —                                | session cleanup also in worker maintenance (serverless timers are unreliable)                                                                                                                                                   | integration test                                                                                                                                                                                          |
| —                                | accessibility: "Expected" label contrast 3.7:1 → AA                                                                                                                                                                             | axe-core: 0 WCAG 2.1 A/AA violations over 49 page states                                                                                                                                                  |

## Verification (final run)

| Gate                                            | Result                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm format:check`                             | pass                                                                        |
| `pnpm lint`                                     | pass (0 warnings)                                                           |
| `pnpm typecheck`                                | pass                                                                        |
| `pnpm test`                                     | shared 220, API 334, web 284, worker 5 — all pass                           |
| `pnpm test:integration` (local `calmcash_test`) | 261 tests, 28 files — all pass (plus 2 added afterwards, passing)           |
| `pnpm build` + `check:artifacts --production`   | pass (39 assets); negative test with a localhost API origin correctly fails |
| Docker images                                   | both build; signal tests pass                                               |
| Browser (Chromium 1155 only)                    | 26/26 checks + offline/retry/update + link flow + axe 0 violations          |
| Load (synthetic)                                | see [scalability-and-performance.md](scalability-and-performance.md)        |

**Not verified here:** Firefox and Safari/WebKit (not installed — no claim is made for them);
real install prompts (headless Chromium does not offer installation); anything on Vercel, Neon,
or Blob (no deployment, environment change, or remote migration was made); the GitHub Actions
workflows themselves (they have not run yet).

**Frontend bundle:** initial JavaScript (gzip) — `/login` 268 KB, `/transactions` 345 KB,
`/dashboard` 488 KB (Recharts is a separate chunk loaded only on chart routes). The shared Zod
chunk is ~47 KB gzip; using `zod/mini` for client-side schemas is a possible future saving.

## Before going live (required)

1. **Apply migrations to Neon** — `20261103090000_financial_intelligence` and
   `20261104090000_shared_rate_limits` — with the _Database migration_ workflow after a backup.
   Not done in this phase (needs explicit approval).
2. Configure production secrets (`DATABASE_URL` pooled, `DIRECT_URL` in the migration
   environment, SMTP, Blob, optional `OPS_STATUS_TOKEN`) and `AI_ENABLED=false`,
   `TRUST_PROXY_HOPS=1`; verify sign-in, CSRF writes, and receipts on a preview.
3. Decide the backup policy beyond Neon's plan window (daily encrypted dumps + receipt copies)
   and rehearse a Neon point-in-time restore on a non-production branch.
4. Fix the developer `.env`: `TEST_DATABASE_URL` points at the Neon database (the test guard
   refuses it, but it should name the local `calmcash_test`).
5. Enable GitHub secret scanning / push protection; let CI run once and protect `main`.
6. Account deletion is **not implemented** — a documented prerequisite
   ([security.md](security.md#data-protection-and-retention)).

## Known limitations

- Production images are ~800 MB: `@prisma/client` auto-installs its `prisma` CLI peer (with
  Studio and TypeScript); excluding it would need a lockfile setting change.
- CSP keeps `'unsafe-inline'` for scripts and styles (static rendering); nonces are the next step.
- Vercel Hobby limits (non-commercial use, Blob usage blocking, daemon memory) — see
  [deployment-architecture.md](deployment-architecture.md#free-tiers-and-costs-checked-2026-11-confirm-before-relying-on-them).
- Very large data exports on Vercel Functions are bounded by duration and memory; untested there.
- Offline mode is informational only; no offline reading of figures or offline writes (by design).
