# Scalability and performance

## Targets (objectives — what we aim for, not measurements)

| Area                  | Target                                                               |
| --------------------- | -------------------------------------------------------------------- |
| API reads (p95, warm) | ≤ 150 ms for list/summary endpoints; ≤ 300 ms for insights/forecasts |
| API writes (p95)      | ≤ 250 ms for a transaction create without contention                 |
| Dashboard aggregation | ≤ 100 ms server time for a user with 20 000 transactions             |
| Page load (web)       | first contentful paint ≤ 2 s on a mid-range phone over 4G            |
| Worker latency        | a due job claimed within 2 poll intervals (10 s by default)          |
| Database connections  | ≤ 10 per API instance (pg pool default) and ≤ 10 per worker          |
| File upload           | 4 MB receipt accepted in ≤ 2 s on the API side                       |

## Measured (2026-11-05)

Environment: Intel Core i5-12400 (6 cores / 12 threads), 7.8 GB RAM, Windows 11; Node.js 24.13.1;
**one** API process (built `dist/server.js`, development mode for plain-HTTP cookies); PostgreSQL
18 in Docker Desktop (Linux VM, 12 vCPU, 3.7 GB); load generator on the same machine. Dataset
(synthetic, `pnpm --filter @calmcash/api seed:synthetic`): 20 users, 58 800 transactions over
24 months (one user with 20 000), 60 accounts, 40 budgets, 20 schedules.

**Single requests, heaviest user (median of 7 warm requests, ms):**

| Endpoint                                         | p50         |
| ------------------------------------------------ | ----------- |
| `GET /dashboard/overview?period=this-month`      | 27.8        |
| `GET /dashboard/trends?period=last-6-months`     | 16.2        |
| `GET /transactions?page=1&pageSize=25`           | 12.7        |
| `GET /transactions?q=FreshMart` (text search)    | 42.7        |
| `GET /accounts` / `/accounts/summary`            | 24.9 / 24.0 |
| `GET /budgets` / `/budgets/summary`              | 28.7 / 24.4 |
| `GET /recurring/upcoming`                        | 9.6         |
| `GET /notifications/unread-count`                | 6.7         |
| `GET /intelligence/overview`                     | 36.7        |
| `GET /intelligence/cashflow-forecast?horizon=30` | 34.2        |
| `GET /insights`                                  | 127.9       |

**Mixed read load** (16 endpoints round-robin across 20 signed-in users, 30 s):

| Concurrency | Throughput | p50   | p95    | p99    | Errors |
| ----------- | ---------- | ----- | ------ | ------ | ------ |
| 10          | 229 req/s  | 39 ms | 83 ms  | 111 ms | 0      |
| 25          | 273 req/s  | 84 ms | 177 ms | 210 ms | 0      |

Throughput plateaus around 230–270 req/s: one Node.js process is CPU-bound and the default pg
pool (10 connections) queues beyond that. Scale horizontally (more API instances — rate limits
are now shared, sessions are in PostgreSQL) before tuning.

**Concurrent writes:** 400 `POST /transactions` across 10 users (10 accounts) at concurrency 10:
141 writes/s, p50 68 ms, p95 96 ms, all 201; the database afterwards held exactly 400 rows summing
to 400 × 1 234 minor units with 400 distinct idempotency keys.

**Receipts:** 200 downloads at concurrency 10: p50 30 ms, p95 62 ms; another user's request for
the same receipt → 404 with `Cache-Control: no-store`.

**Query plans:** captured with `auto_explain` (`log_analyze`) on the synthetic database only. No
sequential scan over more than 1 000 rows in any hot path; every per-user query starts from
`transactions (user_id, occurred_at DESC)` or `(account_id, occurred_at DESC)`. Slowest
statements: the free-text search `COUNT` (~37 ms for the 20 000-row user — it filters that user's
rows with `ILIKE` on description, merchant, and category name) and the account-balance CTE
(~17 ms, used by accounts, budgets, and intelligence). No index was added: both are linear in one
person's history and comfortably within target at this size.

**Web bundle** (production build, initial JavaScript per route, gzip): `/login` 268 KB,
`/transactions` 345 KB, `/dashboard` 488 KB. Recharts (~358 KB raw) is its own chunk, loaded only
on chart routes; there are no duplicate chart or icon libraries. Pages are static shells whose
data is fetched on the client, so loading states never show invented figures.

## Known scaling limits

- **Text search** is linear in the person's transaction count. Beyond ~100 000 transactions per
  person, add a `pg_trgm` GIN index on the searched columns (measure first).
- **Balances are derived** on read. Fine at tens of thousands of rows per account; a materialised
  running balance would be the next step, with the ledger's locks keeping it consistent.
- **Insights** run several aggregate queries sequentially (~130 ms). Acceptable; parallelise
  only if p95 targets are missed.
- **Serverless connections**: each Vercel Function instance opens its own pool. Use Neon's pooled
  URL (PgBouncer) for `DATABASE_URL`; never the direct URL at runtime.
- **Write contention** is per account (row locks). Many simultaneous writes to one account queue;
  this is the intended correctness trade-off.
- The figures above come from one machine with the load generator alongside the server; they are
  a baseline for regressions, **not** a promise of concurrent-user capacity in production.

## Reproducing

```sh
# separate database, never DATABASE_URL's
SYNTHETIC_DATABASE_URL=postgresql://…/calmcash_perf pnpm --filter @calmcash/api seed:synthetic
```

Then run the API against that database and a load generator of your choice; never run load tests
against production.
