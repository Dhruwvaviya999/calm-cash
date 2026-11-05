# ADR 0008: Private receipt storage behind the API

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

Receipt files are stored under random 128-bit keys in private storage (a directory on a
persistent volume, or a private Vercel Blob store) and only streamed by the API after session and
ownership checks. Rows are written after files and deleted before them; an audit finds orphans
and missing files.

## Why

- No public URL can leak a receipt; access control lives in one place.
- File names and contents never become paths; content signatures are verified.

## Trade-offs

- Every download goes through the API (bounded by function limits on Vercel: 4 MB uploads).
- Backups must cover files and database together; the audit reconciles them after a restore.
