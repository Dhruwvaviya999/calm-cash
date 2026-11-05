# ADR 0009: No shared or offline caching of personal data

Status: accepted (documented in Phase 12; decided in the phase that introduced it).

## Decision

API responses carry `Cache-Control: no-store`; the service worker caches only content-hashed
build assets, icons, the manifest, and a static offline page. Pages and React Server Component
payloads always come from the network. Offline creation of transactions is not offered.

## Why

- A cache keyed by URL could serve one person's finances to another (shared devices, proxies).
- Stale balances shown as current are worse than an honest "you are offline".
- Offline writes would need conflict resolution and idempotent sync for money; not justified yet.

## Trade-offs

- No offline reading of figures; the installed app needs a connection to show money.
- Every navigation hits the server (static pages are cheap; data is fetched by the client).
