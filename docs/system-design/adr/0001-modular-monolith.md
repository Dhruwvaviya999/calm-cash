# ADR 0001: Modular monolith instead of microservices

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

CalmCash has one API process holding every financial rule, a web client, and a worker that
imports the API's domain code. Modules (accounts, transactions, planning, imports, notifications,
AI, intelligence) have explicit dependencies and never import each other's routes.

## Why

- Financial invariants (balances, transfers, budgets, imports) need one transaction across
  several tables; a single database and process make that a local transaction instead of a saga.
- One person maintains the system; one deployable unit plus a worker keeps operations small.
- Module boundaries keep the option to split later (the worker already runs separately).

## Trade-offs

- Scaling is horizontal copies of the whole API, not per module. Measured headroom
  ([scalability-and-performance.md](../scalability-and-performance.md)) makes this acceptable.
- A bug in one module can take down the API process; health checks and fast rollback mitigate.
