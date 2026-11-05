# System architecture

CalmCash is a **modular monolith** ([ADR 0001](adr/0001-modular-monolith.md)): one Express API
holding all financial rules, one Next.js web client, and one background worker that reuses the
API's domain code. PostgreSQL is the only stateful dependency besides private receipt storage.
Detailed module documentation stays in [../architecture.md](../architecture.md); this page is
the map.

## 1. Components

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js client<br/>React, Tailwind, Recharts]
    SW[Service worker<br/>static assets + offline page only]
  end
  subgraph Host["Vercel project (same origin)"]
    WEB[web service<br/>Next.js App Router]
    API[api service<br/>Express 5 · /api/v1]
    WRK[worker daemon<br/>Dockerfile.worker]
  end
  PG[(PostgreSQL<br/>Neon)]
  BLOB[(Private receipt storage<br/>Vercel Blob or volume)]
  SMTP[[SMTP provider]]
  OLL[[Ollama<br/>private network only<br/>off on Vercel]]

  UI -- HTML, JS --> WEB
  UI -- "fetch /api/v1 (cookie + CSRF)" --> API
  SW -. caches hashed /_next/static .-> UI
  API --> PG
  API --> BLOB
  API -- verification / reset mail --> SMTP
  API -. optional .-> OLL
  WRK --> PG
  WRK -- notification e-mail --> SMTP
```

| Component | Runs as                                         | State                                            | Talks to                                             |
| --------- | ----------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| web       | Next.js (static + client rendered)              | none                                             | nothing server-side; browser calls the API           |
| api       | Express on Vercel Functions or `Dockerfile.api` | none (sessions, rate limits, jobs in PostgreSQL) | PostgreSQL, receipt storage, SMTP, Ollama (optional) |
| worker    | long-running Node process (`Dockerfile.worker`) | none (jobs in PostgreSQL)                        | PostgreSQL, SMTP                                     |
| shared    | TypeScript package bundled into all three       | —                                                | —                                                    |

No component calls another over HTTP except the browser → API. The worker imports the API's
automation module at build time; it never calls the API.

## 2. Browser ↔ API

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (app origin)
  participant A as API /api/v1
  participant D as PostgreSQL
  B->>A: GET /auth/me (cookie)
  A->>D: session by SHA-256(token), idle + absolute expiry
  A-->>B: user + CSRF token (Cache-Control: no-store)
  B->>A: POST /transactions (cookie, X-CSRF-Token, Idempotency-Key, Origin)
  A->>A: CORS allowlist · Origin check · CSRF · Zod · rate limit
  A->>D: one database transaction (row locks, constraints)
  A-->>B: 201 envelope { success, data } with X-Request-Id
```

- Every response is JSON `{ success, data }` or `{ success: false, error: { code, message,
details?, requestId } }`; the web client validates both with the shared Zod schemas.
- On Vercel the browser uses relative `/api/v1` URLs (same origin). Standalone, it uses
  `NEXT_PUBLIC_API_URL` (`localhost:3000` → `localhost:4000`, same site).
- Nothing authenticated is cacheable: `Cache-Control: no-store` on every API response (set per
  router and again app-wide), and the service worker never handles `/api/*`.

## 3. API module boundaries

```mermaid
flowchart TB
  subgraph Edge["HTTP edge (app.ts)"]
    RL[request id + pino log] --> H[Helmet] --> C[CORS allowlist] --> O[Origin check] --> J[JSON limit] --> NS[no-store]
  end
  NS --> V1[routes/v1.ts composition root]
  V1 --> AUTH[auth<br/>sessions, CSRF, passwords]
  V1 --> LEDGER[transactions<br/>the ledger]
  V1 --> ACC[accounts] & CAT[categories/tags] & DASH[dashboard]
  V1 --> PLAN[budgets · recurring · subscriptions · goals]
  V1 --> IMP[imports · receipts]
  V1 --> NOTE[notifications]
  V1 --> AI[ai · insights]
  V1 --> INT[intelligence]
  V1 --> EXP[exports]
  V1 --> HEALTH[health]
  PLAN -- recordLinked / get --> LEDGER
  IMP -- record / reconcile --> LEDGER
  AI -- read-only tools --> DASH & LEDGER & PLAN & INT
  INT -- read-only --> ACC & PLAN & DASH
  WORKER[automation engine<br/>apps/api/src/automation] -. imported by apps/worker .-> PLAN & NOTE
```

Rules: modules never import each other's routes; money only moves through the transactions
service (its `recordLinked` lets planning and imports write atomically with their own rows); the
AI layer has read-only tools; the worker's ledger stub refuses every write.

## 4. Authentication and session

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant D as PostgreSQL
  B->>A: POST /auth/login {email, password} (Origin)
  A->>D: shared rate-limit counters (per IP, per e-mail; failures only)
  A->>D: user by e-mail
  A->>A: Argon2id verify (dummy hash when unknown → same timing)
  A->>D: INSERT session (SHA-256 token hash, CSRF hash, expiry)
  A-->>B: Set-Cookie __Host-calmcash_session; HttpOnly; Secure; SameSite=Strict; Path=/
  Note over B,A: later requests
  B->>A: request with cookie (+ X-CSRF-Token on unsafe methods)
  A->>D: session lookup; touch lastActiveAt at most periodically
  A-->>B: 401 UNAUTHORIZED when expired, idle, or revoked
```

Password change or reset revokes other sessions; reset tokens are single-use, hashed, and
short-lived. Details: [../authentication.md](../authentication.md) and
[security.md](security.md).
