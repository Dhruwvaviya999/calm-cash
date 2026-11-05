# Runbooks

Placeholders like `$PROD_DIRECT_URL` stand for values kept in the platform's secret store — never
paste real credentials into tickets, chats, or this file. Health endpoints:
`/api/v1/health` (liveness), `/api/v1/health/ready` (database), `/api/v1/health/status`
(operator, `Authorization: Bearer $OPS_STATUS_TOKEN`).

Each runbook: **Symptoms → Diagnose → Recover → Verify → Never.**

---

## Application deployment

**Symptoms:** a release is due (merged to `main`). **Diagnose:** CI is green on the merge commit;
the Database migration workflow shows no pending migrations, or they are applied first.
**Recover/Do:**

1. If the release has migrations: run _Database migration_ → `staging`, then `production`
   (status only), take a backup ([Backup creation](#backup-creation)), then apply.
2. Promote/merge so Vercel builds `main` (web + api services, worker daemon).
3. The worker daemon restarts with the new image; old and new can overlap safely.
   **Verify:** `/health/ready` 200; `/health/status` `ok` with a fresh worker heartbeat; sign in,
   create and void a test transaction in a test account, upload/download a receipt; browsers show
   "A new version is ready" within 30 minutes or on focus.
   **Never:** deploy with failing CI; run migrations from a laptop pointed at production without
   the workflow's checks; edit production environment variables during a deploy.

## Database migrations

**Diagnose:** `pnpm exec prisma migrate status` against the target (the workflow prints host and
database without credentials). The Phase 11 (`20261103090000_financial_intelligence`) and Phase 12
(`20261104090000_shared_rate_limits`) migrations are **not yet applied to Neon**.
**Do:** GitHub → Actions → _Database migration_ → environment, tick _backup confirmed_, first
without _apply_ (status), then with _apply_. Locally, only for isolated databases:
`DIRECT_URL=… pnpm db:deploy`.
**Verify:** status "Database schema is up to date"; app smoke test.
**Never:** `prisma migrate dev`, `migrate reset`, or `db push` against shared or production
databases; run migrations automatically on pull requests; point `TEST_DATABASE_URL` at Neon.

## Rollback or forward-fix

Migrations so far are additive (new tables, columns, constraints on new data). **Prefer
forward-fix:** a new migration that corrects the schema, applied through the workflow. For code,
roll back by redeploying the previous Vercel deployment ("Instant Rollback") — the additive schema
stays compatible with the previous code. Only if a migration destroyed or corrupted data: restore
([Database restoration](#database-restoration)). **Never** hand-edit `_prisma_migrations` or
delete a migration that ran anywhere; mark a failed one with `prisma migrate resolve` only after
understanding why it failed.

## API outage

**Symptoms:** `/api/v1/health` not 200; the web app shows "could not reach the service".
**Diagnose:** Vercel deployment/function logs (search by `requestId` from the error banner);
`/health` vs `/health/ready` (process up but database down → see next runbook); recent deploy?
**Recover:** roll back to the previous deployment if it started with a release; otherwise check
configuration errors at start-up (the log names the invalid variable, never its value).
**Verify:** health endpoints 200; sign-in works. **Never:** enable debug logging in production for
long, or log request bodies.

## Database outage

**Symptoms:** `/health` 200 but `/health/ready` 503; `/health/status` `database: down`.
**Diagnose:** Neon status page and console (compute suspended? quota exceeded? connection limit?);
use the **pooled** URL at runtime. **Recover:** resume compute / raise the limit / wait for the
provider; the API recovers automatically (connections are lazy). Writes failed atomically during
the outage — nothing partial was saved. **Verify:** `/health/ready` 200, worker heartbeat fresh.
**Never:** switch `DATABASE_URL` to an untested database, or restore over production as a first move.

## Worker outage / stale jobs

**Symptoms:** `/health/status` `worker: stale` or `never_seen`; Settings says reminders are not
running; `jobs.oldestDueSecondsAgo` growing.
**Diagnose:** daemon logs (`calmcash-worker`); `pnpm worker:status` with the production
environment (counts and worker IDs only). **Recover:** restart the daemon; jobs left `processing`
by a crashed worker are recovered automatically after their lease (`WORKER_LEASE_MS`, 2 min);
permanently failed jobs: `pnpm --filter @calmcash/worker requeue-failed [ids…]` after fixing the
cause (`last_error_code`). **Verify:** heartbeat < 60 s, `processing` returns to 0 between cycles,
`oldestDueSecondsAgo` near 0. **Never:** set jobs to `succeeded` by hand; delete
`notifications` rows to "resend" (identities prevent duplicates for a reason).

## E-mail delivery failures

**Symptoms:** `emailDeliveries.failed`/`retryScheduled` growing; people report missing mail;
in-app notices "e-mail problem". **Diagnose:** worker logs `outcome` per delivery (no addresses);
provider dashboard (auth failures, sending limits, domain verification). **Recover:** fix
credentials/sender ([Credential rotation](#security-credential-rotation)); temporary failures retry
automatically; failed reminders are not re-queued (they would be out of date) — the next daily
review creates what is still relevant. Verification/reset mail: ask the person to request a new one.
**Verify:** a test account receives verification mail; `failed` stops growing.
**Never:** point production at Mailpit or a personal mailbox; disable e-mail verification.

## Receipt-storage failures

**Symptoms:** uploads or downloads fail with 5xx; logs mention storage errors.
**Diagnose:** Blob store status and usage (Hobby limits **block** access when exceeded); token
present (`BLOB_READ_WRITE_TOKEN`); for volumes, mount and free space. **Recover:** restore access
or capacity; nothing else is lost (receipt rows are written only after the file; failed deletes
leave orphans for the audit). Then `pnpm --filter @calmcash/api receipts:audit` with production
env (report only). **Verify:** upload/download/delete a receipt on a test transaction; audit shows
0 missing. **Never:** make the Blob store public or serve files from a public URL.

## Backup creation

```sh
pg_dump --format=custom --no-owner --no-privileges "$PROD_DIRECT_URL" > calmcash-$(date -u +%Y%m%dT%H%M%SZ).dump
# then copy receipt storage (receipts/**) to the same protected location, and encrypt both
```

Before every migration also create a Neon snapshot/branch. Verify: `pg_restore --list file.dump`
succeeds; run the [restore drill](backup-and-disaster-recovery.md#restore-drill) quarterly.
**Never:** store dumps in Git, a public bucket, or unencrypted shared drives.

## Database restoration

1. Declare an incident; stop the worker daemon; block writes (take the API down or switch to
   maintenance).
2. Neon: restore to a **new branch** at the chosen time (within the plan's window), or
   `pg_restore` the latest dump into a new database.
3. Run the drill checks against it (`scripts/restore-drill.sh` steps 3–6 or the SQL checks).
4. Point `DATABASE_URL`/`DIRECT_URL` at the restored branch, redeploy, start the worker.
5. Run the receipt audit; restore missing files ([Receipt recovery](#receipt-recovery)).
   **Verify:** health endpoints, a known account's balance matches expectations, migrations up to
   date. **Never:** restore over the only copy of production; delete the old branch before the new
   one is verified.

## Receipt recovery

`receipts:audit` lists receipt IDs whose files are missing. Copy those objects back from the file
backup to the same path (`receipts/<first two key characters>/<key>` in Blob, or the same relative
path on the volume) — the key is in `transaction_receipts.storage_key`. Re-run the audit; remove
orphans older than 24 h with `--delete-orphans`. **Never:** rename keys or change `storage_key` rows.

## Security credential rotation

| Credential         | Rotate by                                                                                                           | Effect                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Database password  | Neon: reset role password → update `DATABASE_URL` and `DIRECT_URL` (prod + migration env) → redeploy API and worker | brief errors until redeployed           |
| SMTP credentials   | provider → `SMTP_USER`/`SMTP_PASSWORD` in API and worker → redeploy                                                 | queued mail retries automatically       |
| Blob token         | reconnect/rotate the store token → redeploy API                                                                     | uploads/downloads fail until redeployed |
| `OPS_STATUS_TOKEN` | generate 32+ random chars → update API env and the monitor                                                          | none for users                          |
| All user sessions  | `DELETE FROM sessions;` (production SQL, incident only)                                                             | everyone signs in again                 |

**Never** commit or paste credentials; rotate immediately if one appears in a log, issue, or
commit (then purge history with the repository host's tooling).

## PWA / service-worker update problems

**Symptoms:** people see an old version, a blank page, or chunk-load errors after a deploy.
**Diagnose:** `/sw-version.js` shows the new version? Browser devtools → Application → Service
workers (waiting worker?), Cache storage (only `calmcash-static-v1` and `calmcash-shell-<version>`).
**Recover:** ask the person to choose "Reload now" or close all CalmCash tabs. Emergency kill
switch: deploy with `NEXT_PUBLIC_SERVICE_WORKER=off` — every browser unregisters the worker on its
next visit (pages and data never came from the worker, so nothing is lost).
**Never:** add cache rules for HTML, `/api/*`, or RSC payloads to "fix" offline behaviour.

## Ollama unavailable / disabling AI

**Symptoms:** assistant answers "AI is unavailable"; `/api/v1/ai/status` reports the provider
unreachable. Everything else works. **Recover:** restart the private Ollama service or pull the
model; or set `AI_ENABLED=false` and redeploy (required on Vercel). People can also switch AI off
for themselves in Settings. **Never:** expose Ollama on a public address or add a hosted fallback.

## Incident response

1. **Triage:** what is affected (health endpoints, `/health/status`), since when, how many people.
2. **Contain:** roll back the deployment; stop the worker if it is doing harm; rotate any exposed
   credential; take the API down if data integrity is at risk (better unavailable than wrong).
3. **Preserve evidence:** export relevant logs (request IDs, error codes — they contain no
   personal data by design); create a Neon branch snapshot before any repair.
4. **Recover** with the specific runbook above; verify balances on affected accounts with SQL
   against the ledger (balances are derived, so they are correct whenever the rows are).
5. **Communicate** what happened and what people should check; never include other people's data.
6. **Review:** write down cause, timeline, and the change that prevents a repeat.
