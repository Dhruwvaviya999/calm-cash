# ADR 0002: PostgreSQL-backed job queue (no Redis)

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

Background work (reminders, alerts, summaries, e-mail) is stored in `automation_jobs` and
`notification_deliveries`, claimed with `FOR UPDATE SKIP LOCKED` and leases, and processed by
`apps/worker`. Events are written in the same transaction as the change that causes them.

## Why

- Exactly-once creation of work: the event commits with the money or not at all.
- No extra service to run, secure, back up, or pay for; backups already include the queue.
- Volume is low (per-person daily reviews and occasional alerts).

## Trade-offs

- Polling adds up to one poll interval of latency (5 s default).
- Queue tables need retention (maintenance deletes finished rows after 30/90 days).
- Very high throughput would need a dedicated queue; not expected for this product.
