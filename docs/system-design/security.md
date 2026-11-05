# Security and data protection

Review basis: OWASP ASVS / Top 10 categories, the Next.js CSP and data-security guides, and the
existing design in [../authentication.md](../authentication.md). This page records what was
verified in Phase 12, what changed, and what remains open.

## Authentication and sessions — verified

| Control                     | Implementation                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Password hashing            | Argon2id; dummy hash for unknown e-mail addresses (no timing oracle)                                              |
| Session tokens              | random opaque tokens; only SHA-256 hashes stored ([ADR 0005](adr/0005-server-side-opaque-sessions.md))            |
| Cookie                      | `__Host-calmcash_session` in production: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`           |
| Expiry                      | absolute (`SESSION_MAX_AGE_DAYS`) and idle (`SESSION_IDLE_TIMEOUT_HOURS`); revocation per device or all others    |
| CSRF                        | per-session token (hashed) required on unsafe methods + `Origin` allowlist check                                  |
| E-mail verification / reset | hashed, single-use, expiring tokens; reset revokes every session                                                  |
| Password change             | requires the current password (rate limited); signs out every other device                                        |
| Stale records               | sessions/tokens deleted 7 days after they became unusable (API timer **and**, since Phase 12, worker maintenance) |

## Rate limits — now shared across instances

Every limiter uses PostgreSQL counters (`rate_limit_counters`, migration
`20261104090000_shared_rate_limits`): one atomic `INSERT … ON CONFLICT` fixed window per hit,
database clock, keys stored only as SHA-256 of limiter name + subject (no e-mail address or IP at
rest), expired rows deleted by the worker a day later. Limits survive restarts, cold starts, and
apply across any number of API instances. If PostgreSQL is unreachable the request fails (500)
instead of passing unlimited. `429` responses carry `Retry-After` (seconds left in the window) and
`RateLimit-Policy` / `RateLimit` headers.

| Limiter                             | Subject                  | Limit / window                                                      |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| sign-in failures                    | IP · normalised e-mail   | 30 / 15 min · 10 / 15 min                                           |
| register                            | IP                       | 10 / h                                                              |
| verify e-mail                       | IP                       | 30 / h                                                              |
| resend verification                 | IP · e-mail              | 10 / h · 5 / h                                                      |
| forgot password                     | IP · e-mail              | 10 / h · 5 / h                                                      |
| reset password                      | IP                       | 20 / h                                                              |
| change password                     | user                     | 10 / h                                                              |
| receipt uploads · statement uploads | user (separate counters) | 60 / 10 min each                                                    |
| AI model requests                   | user                     | `AI_MAX_REQUESTS_PER_USER` / `AI_RATE_WINDOW_MINUTES` (30 / 10 min) |
| intelligence                        | user                     | 600 / 10 min                                                        |
| data export                         | user                     | 5 / h                                                               |

Single instance: identical behaviour to before (one store). Multi-instance: one shared count.
Ordinary reads and writes (transactions, budgets, notifications) are not rate limited; they are
protected by authentication, ownership checks, body limits, and pagination caps.

## HTTP headers

**Web (all routes, `next.config.ts`):** CSP without nonces (keeps pages static) —
`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:; font-src 'self'; connect-src 'self' [API origin]; worker-src 'self';
manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'` (+ `upgrade-insecure-requests` on Vercel); HSTS 2 years with subdomains;
`X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy:
strict-origin-when-cross-origin` (`no-referrer` on token pages); `Permissions-Policy` denying
camera, microphone, geolocation, payment, USB; `Cross-Origin-Opener-Policy: same-origin`.
`'unsafe-inline'` remains for scripts (Next.js inline bootstrap and the theme script) and styles
(Radix/Recharts). Verified in Chromium: every page in light and dark at 8 widths with no console
or CSP errors. Next step for hardening: nonce-based CSP via a proxy, at the cost of dynamic
rendering ([Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy)).

**API:** Helmet defaults (CSP `default-src 'self'`, HSTS, nosniff, frame denial, CORP), no
`X-Powered-By`, `Cache-Control: no-store` on every `/api/v1` response, request IDs, JSON body limit,
raw-body limits for uploads. Receipt files: `Content-Disposition` attachment/inline with a safe
name, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src
'self'; sandbox`, `Cache-Control: private, no-store`, served only after session + ownership checks.

## Input and output

- Zod on every request (strict objects reject unknown keys → no mass assignment), on responses in
  the client, and on environment variables.
- SQL only through Prisma or tagged `$queryRaw` templates (parameterised). No string-built SQL.
- React escapes output; no `dangerouslySetInnerHTML` except the static theme bootstrap.
- Uploads: size limits while streaming, content-signature detection (JPEG/PNG/WebP/PDF), random
  storage keys, path-traversal guard, file names never touch the filesystem.
- CSV statements, notes, merchants, file names, and AI output are untrusted data everywhere
  (validated, length-limited, rendered as text).
- Redirect targets after sign-in are validated (`lib/return-to.ts`: same-origin relative paths only).

## Financial operations — verified

Transactions, transfers, reconciliation adjustments, recurring recording and (new) linking,
imports, and goal contributions all run in one database transaction with `SELECT … FOR UPDATE`
on the affected rows, ownership in every `WHERE`, idempotency keys or linked-row claims against
retries, and database constraints as the last line (positive amounts, transfer shape, unique
links). The worker cannot write money. See [transaction-processing.md](transaction-processing.md).

## Dependencies (pnpm audit, 2026-11-04 → after fixes)

| Package             | Severity    | Path                                                                                       | Reachable?                                            | Action                                  |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------- |
| nodemailer < 10.1.4 | moderate ×3 | api, worker (direct)                                                                       | address parser on recipient/sender headers            | **upgraded to ~10.1.7**                 |
| zod < 4.6.6         | high        | `@vercel/blob`/`@vercel/functions` → `@vercel/oidc` → `@vercel/cli-config` (pinned 4.1.11) | only parses local CLI config; not user input          | **pnpm override → workspace zod 4.6.7** |
| minimatch < 11.0.1  | moderate    | ESLint and its plugins (dev only)                                                          | not shipped; patterns come from the repo's own config | accepted; resolves with ESLint upgrades |

No secret scanner binary (gitleaks/trufflehog) is installed here; a pattern scan of tracked files
found only documented placeholders. `.gitignore`, `.dockerignore`, and `.vercelignore` exclude
`.env*`, receipts, keys, logs, and build output; CI's artefact check refuses secrets in browser
assets. **Recommendation:** enable GitHub secret scanning and push protection on the repository.

## Data protection and retention

| Data                                                                                 | Retention                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Accounts, transactions, plans, goals, imports, receipts, scenarios, AI conversations | until the person deletes them (transactions are voided, not deleted)                   |
| Notifications                                                                        | 400 days                                                                               |
| E-mail delivery records / finished jobs                                              | 90 days / 30 days                                                                      |
| Sessions and e-mail tokens                                                           | 7 days after they became unusable                                                      |
| Rate-limit counters                                                                  | 1 day after the window ended                                                           |
| Worker heartbeats                                                                    | 7 days after a worker disappeared                                                      |
| Backups                                                                              | per backup policy ([backup-and-disaster-recovery.md](backup-and-disaster-recovery.md)) |

**Export (new):** Settings › Your data › Download my data → `GET /api/v1/exports/financial-data`.
Session required, 5 per hour, streamed JSON (no stored file, no public URL), exact minor units
as strings, scoped to the signed-in person. Excludes password hashes, sessions, tokens,
idempotency keys, storage keys, and internal job/delivery rows; receipt files themselves are
downloaded individually. On Vercel, very large exports are bounded by function duration and
memory — validate with a large synthetic account on a preview before relying on it.

**Account deletion: a production prerequisite, deliberately not implemented in this phase.**
A safe implementation needs: re-authentication and explicit confirmation; deletion of private
receipt files (with the orphan audit as a safety net); suppression of pending jobs and
deliveries; handling of the `NO ACTION` foreign keys (accounts, categories) inside one
transaction; a decision on how long backups keep deleted data; and documentation of what is
deleted versus retained. No legal retention period is claimed here.

## Logging

pino JSON logs with timestamp, level, component (`calmcash-api` / `calmcash-worker`), request ID,
job/delivery IDs, error codes, durations. Never logged: passwords, cookies, tokens, SMTP
credentials, connection strings, receipt contents, statement files, AI conversation text, e-mail
addresses (tests assert the worker's logs contain no addresses, names, descriptions, or amounts).
