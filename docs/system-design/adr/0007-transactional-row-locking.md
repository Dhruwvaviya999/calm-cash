# ADR 0007: Row locks inside one transaction for every money write

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

Every write that affects balances runs in one database transaction that first locks the linked
rows (schedule, import row) and then the affected accounts with `SELECT … FOR UPDATE`, in a
global order, before checking rules and writing.

## Why

- Concurrent requests (two tabs, retries, the same import committed twice) serialise on the
  account, so limits and balance rules are checked against committed data.
- A global lock order prevents deadlocks.

## Trade-offs

- Writes to one account are serialised (measured: 141 writes/s across 10 accounts; tail latency
  grows when many writers hit the same account).
- Interactive transactions hold a pooled connection while they run; they are kept short.
