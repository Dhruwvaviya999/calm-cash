# ADR 0006: Transfers as a single row

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

A transfer is one `transactions` row with `account_id` (from) and `transfer_account_id` (to).

## Why

- Two rows can drift apart (one voided, one edited); one row cannot.
- Balance derivation subtracts from one account and adds to the other from the same row.

## Trade-offs

- Queries for "activity of an account" must look at both columns (indexed).
- Cross-currency transfers are not supported by this shape (same currency is enforced).
