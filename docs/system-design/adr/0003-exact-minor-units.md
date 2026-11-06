# ADR 0003: Money as exact integer minor units

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

Amounts are `BIGINT` minor units in PostgreSQL, `bigint` in TypeScript, and decimal strings in
JSON and exports. Floating point never touches money.

## Why

- Binary floating point cannot represent most decimal amounts; sums drift.
- JSON numbers lose precision above 2^53; strings travel exactly.

## Trade-offs

- Every boundary must convert explicitly (shared helpers do this); charts convert for display only.
- Multi-currency totals are always per currency; no implicit FX.
