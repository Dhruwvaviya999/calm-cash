# CalmCash system design

The map of the whole system for someone maintaining it without the history of how it was built.
Feature-level detail stays in the existing documents; these pages link to them instead of
repeating them.

| Read this                                                                                   | For                                                                                     |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                                                          | components, browser ↔ API, module boundaries, sign-in and sessions (diagrams 1–4)       |
| [transaction-processing.md](transaction-processing.md)                                      | locking, transfers, imports, reconciliation, settling scheduled payments (diagrams 5–8) |
| [background-worker.md](background-worker.md)                                                | job queue, notification delivery, shutdown, monitoring (diagrams 9–10)                  |
| [ai-and-intelligence.md](ai-and-intelligence.md)                                            | assistant tool orchestration, forecasting and scenarios (diagrams 11–12)                |
| [deployment-architecture.md](deployment-architecture.md)                                    | topology, origins/cookies/CORS, previews, PWA, free tiers and costs (diagram 13)        |
| [backup-and-disaster-recovery.md](backup-and-disaster-recovery.md)                          | backups, recovery objectives, restore drill and its results (diagram 14)                |
| [security.md](security.md)                                                                  | security review, rate limits, headers/CSP, dependencies, data export and retention      |
| [scalability-and-performance.md](scalability-and-performance.md)                            | targets, measured results, query plans, scaling limits                                  |
| [environment-variables.md](environment-variables.md)                                        | every variable: component, required, development vs production, secret                  |
| [runbooks.md](runbooks.md)                                                                  | deployment, migrations, outages, recovery, rotation, incidents                          |
| [adr/](adr/)                                                                                | architecture decisions and their trade-offs                                             |
| [phase-12-audit.md](phase-12-audit.md) · [production-readiness.md](production-readiness.md) | the Phase 12 audit, what changed, verification evidence, open items                     |

Detailed references: [architecture](../architecture.md) (module by module, per phase) ·
[database design](../database-design.md) (entities, money, balances, constraints) ·
[authentication](../authentication.md) · [UI architecture](../ui-architecture.md) ·
[development guide](../development-guide.md) · [Vercel deployment](../vercel-deployment.md).

## Architecture decisions

| ADR                                                   | Decision                                          |
| ----------------------------------------------------- | ------------------------------------------------- |
| [0001](adr/0001-modular-monolith.md)                  | Modular monolith rather than microservices        |
| [0002](adr/0002-postgresql-job-queue.md)              | PostgreSQL-backed job queue                       |
| [0003](adr/0003-exact-minor-units.md)                 | Exact integer minor units for money               |
| [0004](adr/0004-local-first-ollama.md)                | Local-first Ollama, no hosted fallback            |
| [0005](adr/0005-server-side-opaque-sessions.md)       | Server-side opaque sessions, host-only cookies    |
| [0006](adr/0006-single-row-transfers.md)              | Single-row transfers                              |
| [0007](adr/0007-transactional-row-locking.md)         | Row locks inside one transaction for money writes |
| [0008](adr/0008-private-receipt-storage.md)           | Private receipt storage behind the API            |
| [0009](adr/0009-no-shared-caching-of-private-data.md) | No shared or offline caching of personal data     |
