# ADR 0005: Server-side opaque sessions with host-only cookies

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

Sessions are random tokens whose SHA-256 hashes are stored in PostgreSQL, sent as a
`__Host-` cookie (`Secure`, `HttpOnly`, `SameSite=Strict`), with a separate CSRF token for unsafe
requests. No JWTs.

## Why

- Instant revocation (sign out a device, password reset signs out everyone).
- Nothing sensitive is readable by page scripts; a leaked database row cannot be replayed.

## Trade-offs

- Every authenticated request reads the session row (indexed, cheap; activity is written at most
  periodically).
- Web and API must be same-site; cross-site preview setups are not supported
  ([deployment-architecture.md](../deployment-architecture.md#origins-cookies-and-cors)).
