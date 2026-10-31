# CalmCash authentication and security

How people sign up, sign in, and stay signed in, and the protections around it. Established in
Phase 3. The API is the only authority: the web app's route guards exist for user experience, and
every protected request is authorised by the API.

## 1. Deployment model

```text
 Browser ── https://app.calmcash.example ──▶ Next.js (static pages, client-side auth state)
    │
    └──── fetch(credentials: 'include') ───▶ https://api.calmcash.example  (Express, sessions)
          Cookie: __Host-calmcash_session        │
          x-csrf-token: <in-memory token>        └──▶ PostgreSQL (hashed sessions and tokens)
```

- **Same site, different origins.** The web app and the API must share a registrable domain
  (`app.example.com` + `api.example.com`; locally `localhost:3000` + `localhost:4000`). The session
  cookie is `SameSite=Strict`, so a cross-site deployment (`calmcash.app` + `calmcash-api.example`)
  would not work, and third-party-cookie blocking would break it anyway. Do not mix `localhost` and
  `127.0.0.1` locally: they are different sites.
- **The cookie belongs to the API host.** It is host-only (no `Domain`), so the Next.js server never
  sees it. Pages are statically prerendered; the browser restores the session by calling
  `GET /api/v1/auth/me`. Server Components therefore cannot read the session, and nothing secret is
  ever rendered on the Next.js server.
- **CORS** allows exactly the origins in `CORS_ORIGINS` (never a wildcard) with credentials, and the
  `Content-Type`, `x-csrf-token`, and `x-request-id` headers. CORS only controls who may _read_
  responses; it is not relied on as a CSRF defence (§4).

## 2. Flows and endpoints

All routes live under `/api/v1/auth` and answer with the standard `{ success, data | error }`
envelope and `Cache-Control: no-store`.

| Method & path                  | Who       | Purpose                                                     | Success                  |
| ------------------------------ | --------- | ----------------------------------------------------------- | ------------------------ |
| `POST /register`               | public    | Create an unverified account, e-mail a confirmation link    | 202 `RegistrationDto`    |
| `POST /verify-email`           | public    | Consume a confirmation token                                | 200 `EmailVerifiedDto`   |
| `POST /verify-email/resend`    | public    | Send a new confirmation link (generic answer)               | 202 `AcceptedDto`        |
| `POST /login`                  | public    | Verify credentials, open a session, set the cookie          | 200 `AuthSessionDto`     |
| `POST /logout`                 | any       | Revoke the current session, clear the cookie (idempotent)   | 200 `SignedOutDto`       |
| `POST /forgot-password`        | public    | E-mail a reset link (generic answer)                        | 202 `AcceptedDto`        |
| `POST /reset-password`         | public    | Consume a reset token, set a new password, end all sessions | 200 `PasswordResetDto`   |
| `GET /me`                      | signed in | Current user, CSRF token, session expiry                    | 200 `AuthSessionDto`     |
| `PATCH /profile`               | signed in | Update name, preferred currency, time zone                  | 200 `UserDto`            |
| `POST /password`               | signed in | Change password; rotate this session, end all others        | 200 `AuthSessionDto`     |
| `GET /sessions`                | signed in | The caller's active sessions (`current` marks this one)     | 200 `SessionListDto`     |
| `DELETE /sessions/:id`         | signed in | Revoke one of the caller's sessions                         | 200 `RevokedSessionsDto` |
| `POST /sessions/revoke-others` | signed in | Revoke every other session of the caller                    | 200 `RevokedSessionsDto` |

Every signed-in _state-changing_ route also requires the CSRF header. Request and response
contracts are the Zod schemas in `packages/shared/src/schemas/auth.ts`; request bodies are
**strict objects**, so unknown fields (`id`, `email`, `emailVerifiedAt`, `passwordHash`, …) are
rejected rather than ignored.

**Registration → verification.** `register` hashes the password, creates the user and a
verification token in one transaction, and sends the e-mail before answering. No session is
issued. Sign-in is refused with `EMAIL_NOT_VERIFIED` (only after a correct password, so it reveals
nothing to a guesser) until the link is used. If the address already has an account, the response
is identical; the outcome goes by e-mail only: a verified owner gets an "you already have an
account" notice, and an unverified registration is replaced by the newest one (older links stop
working), so someone who squats an address cannot keep a password the real owner later verifies.

**Login.** Unknown addresses spend the same Argon2 effort against a dummy hash, and every failure
returns the same `INVALID_CREDENTIALS` message. A brand-new session is created on every login and
any session presented with the request is revoked (no session fixation). Hashes made with weaker
Argon2 parameters are upgraded transparently.

**Password change.** Requires the current password. In one transaction the hash is replaced, every
session of the user (including the current one) is revoked, and a fresh session is opened for this
browser; the response carries its new CSRF token. A notice is e-mailed.

**Password recovery.** `forgot-password` always answers `202 { accepted: true }` immediately; the
account lookup, token creation, and e-mail happen afterwards in the background, so neither the
response nor its timing reveals whether an address is registered. `reset-password` consumes the
token, sets the password, marks the address verified (the link proved ownership), revokes every
session, and clears this browser's cookie.

## 3. Sessions

| Property                               | Implementation                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token                                  | 32 bytes from `crypto.randomBytes`, base64url (43 chars). Opaque; not a JWT.                                                                         |
| Storage                                | `sessions.token_hash` = SHA-256 hex of the token. The raw token exists only in the cookie.                                                           |
| Cookie                                 | `HttpOnly; SameSite=Strict; Path=/`, host-only. Production: `Secure` and the name `__Host-calmcash_session`. Development (HTTP): `calmcash_session`. |
| Absolute lifetime                      | `SESSION_MAX_AGE_DAYS` (default 14) → `expires_at`; the cookie's `Max-Age` matches.                                                                  |
| Idle timeout                           | `SESSION_IDLE_TIMEOUT_HOURS` (default 72) since `last_active_at`, which is written at most every 5 minutes.                                          |
| Revocation                             | `revoked_at` is set on logout, explicit revocation, password change, and password reset.                                                             |
| Checked on every authenticated request | exists, not revoked, not expired, not idle, user verified. Failing cookies are cleared.                                                              |
| Device label                           | Coarse "Browser on OS" from the User-Agent. No IP addresses or versions are stored.                                                                  |
| Cleanup                                | Hourly job deletes sessions and tokens that have been unusable for 7 days. It never touches a usable session.                                        |

Session IDs exposed by `GET /sessions` are only labels; revocation is scoped by the authenticated
user, so another user's session ID behaves exactly like an unknown one (`404`).

## 4. CSRF protection

Two independent layers:

1. **Origin verification** for every `POST/PUT/PATCH/DELETE`, including login and registration
   (`middleware/origin-check.ts`). An `Origin` outside `CORS_ORIGINS` — or the opaque `null` — is
   rejected with `403 ORIGIN_NOT_ALLOWED`; without `Origin`, `Sec-Fetch-Site: cross-site` is
   rejected. Requests with neither header are not from a browser and cannot carry a victim's cookie.
   JSON-only body parsing means HTML forms cannot submit a usable body either.
2. **Synchronizer token** for signed-in mutations (`auth.middleware.ts`). Each session has a CSRF
   token derived as `HMAC-SHA-256(key = session token, "calmcash:csrf-token:v1")`; only its SHA-256
   hash is stored (`sessions.csrf_token_hash`). It is returned by login, `/me`, and password change;
   the web client keeps it **in memory only** (`lib/session-store.ts`) and sends it as
   `x-csrf-token`. The API compares hashes in constant time and answers `403 CSRF_TOKEN_INVALID`
   otherwise. The token rotates with the session. If another tab rotated the session, the client
   refreshes the token through `/me` and retries the request once.

Logout requires the CSRF token while the session is valid (so other sites cannot sign people out)
and succeeds without one when there is no valid session (safe to retry).

## 5. Passwords and e-mailed tokens

- **Argon2id** (`argon2` package) with the OWASP configuration: 19 MiB memory, 2 iterations,
  1 lane (`password-hasher.ts`). PHC strings only; a CHECK constraint refuses anything else.
- **Policy** (shared by web and API): 12–128 characters, no composition rules, never trimmed,
  plus a small deny-list of common passwords and single repeated characters. Password managers'
  output always qualifies. The password may not equal the e-mail address.
- **Verification and reset tokens:** 32 random bytes, SHA-256 hashed at rest (`auth_tokens`),
  purpose-bound, valid 24 hours (verification) or 30 minutes (reset). Issuing a token deletes the
  user's unused tokens of the same purpose, so only the newest link works.
- **Single use under concurrency:** consumption is one `UPDATE … WHERE token_hash = ? AND
consumed_at IS NULL AND expires_at > now` inside a transaction. PostgreSQL row locking makes a
  concurrent second attempt re-check the condition after the first commits, so exactly one wins
  (covered by integration tests with parallel requests).
- **Links** point at the web app (`WEB_APP_URL`): `/verify-email?token=…` and
  `/reset-password?token=…`. Those pages are served with `Referrer-Policy: no-referrer`, are not
  indexed, and remove the token from the address bar once it has been used.

## 6. Abuse prevention

`express-rate-limit`, in-memory, one counter store per limiter (`auth.rate-limits.ts`):

| Endpoint                    | Limit                                                        |
| --------------------------- | ------------------------------------------------------------ |
| `POST /login`               | 30 failures / 15 min per IP; 10 failures / 15 min per e-mail |
| `POST /register`            | 10 / hour per IP                                             |
| `POST /verify-email`        | 30 / hour per IP                                             |
| `POST /verify-email/resend` | 10 / hour per IP; 5 / hour per e-mail                        |
| `POST /forgot-password`     | 10 / hour per IP; 5 / hour per e-mail                        |
| `POST /reset-password`      | 20 / hour per IP                                             |
| `POST /password`            | 10 / hour per signed-in user                                 |

E-mail keys are normalised (trimmed, lower-cased), so spelling variants share a counter. Successful
sign-ins do not count. Exceeding a limit returns `429 RATE_LIMITED` with `Retry-After` and
`RateLimit` headers.

- **Multiple instances:** counters are per process. With N API instances the effective limit is N
  times higher; use a shared store (e.g. Redis) before scaling out.
- **Proxies:** limits are keyed by `req.ip`. Behind a load balancer set `TRUST_PROXY_HOPS` to the
  number of proxies, or every client shares the proxy's IP.

Other protections: Helmet headers, request-size limit (`JSON_BODY_LIMIT`), Zod validation of all
bodies and path parameters, user ID always taken from the session (never from the client), DTOs
built field by field (no hash or token ever serialised), and logs that never contain passwords,
tokens, cookies, or request bodies (`authorization`/`cookie`/`set-cookie` headers are redacted; mail
logs name only the template).

## 7. Web app

- **`AuthProvider`** (root layout) owns the lifecycle: `loading` → `authenticated` |
  `unauthenticated` (`anonymous`, `signed-out`, `session-ended`) | `error` (API unreachable,
  retryable). It restores the session on start, re-checks when a tab becomes visible after a minute,
  and reacts to any `401 UNAUTHORIZED` from the API client. Nothing goes into browser storage.
- **`RequireAuth`** (in `(app)/layout.tsx`) renders protected pages only when `authenticated`; it
  shows a skeleton while checking (also in the prerendered HTML) and otherwise redirects to
  `/login?next=<page>` with an optional notice. **`GuestOnly`** sends signed-in users away from
  `/login` and `/register`.
- **Return destinations** are accepted only if they are exactly one of the app's navigation routes
  (`lib/return-to.ts`); anything else becomes `/dashboard`, so `next` can never be an open redirect.
- **Limits of client-side protection:** the guard prevents showing UI to signed-out visitors, but
  the JavaScript and prerendered markup of every page are public. That is fine because pages contain
  no personal data — real data is fetched from the API, which authorises every request. The Phase 2
  screens still show clearly labelled **sample data**, never the user's records.

## 8. Configuration

| Variable                      | Purpose                                                  | Default                                  |
| ----------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `CORS_ORIGINS`                | Allowed browser origins (credentials, origin check)      | — (required)                             |
| `WEB_APP_URL`                 | Origin used in e-mailed links; must be in `CORS_ORIGINS` | first CORS origin                        |
| `TRUST_PROXY_HOPS`            | Trusted reverse proxies for client IPs                   | `0`                                      |
| `SESSION_MAX_AGE_DAYS`        | Absolute session lifetime (1–90)                         | `14`                                     |
| `SESSION_IDLE_TIMEOUT_HOURS`  | Idle timeout (≤ max age)                                 | `72`                                     |
| `EMAIL_DELIVERY_MODE`         | `mailpit`, `smtp` (production only), or `disabled`       | `mailpit` outside production             |
| `SMTP_HOST` / `SMTP_PORT`     | SMTP server                                              | `localhost` / `1025` (Mailpit)           |
| `SMTP_SECURE`                 | Implicit TLS (port 465)                                  | `false`                                  |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP credentials (both or neither)                       | none                                     |
| `EMAIL_FROM`                  | Sender address                                           | `CalmCash <no-reply@calmcash.localhost>` |
| `TEST_DATABASE_URL`           | Disposable `*_test` database for integration tests       | — (tests only)                           |

In production (`NODE_ENV=production`) the API refuses to start unless every CORS origin is
`https` and `EMAIL_DELIVERY_MODE` is set (`smtp` then requires `SMTP_HOST` and `EMAIL_FROM`);
cookies are `Secure` with the `__Host-` prefix, and SMTP requires STARTTLS unless
`SMTP_SECURE=true`. Outside production only `mailpit` (a local host, no credentials) or `disabled`
is accepted, so a development `.env` holding real mail credentials refuses to start rather than
sending mail (Phase 9; the worker applies the same rules). Invalid configuration is reported by
variable name only — values (passwords, URLs) are never printed.

**Production checklist**

1. Serve the web app and the API over HTTPS on the same site (e.g. `app.` and `api.` subdomains).
2. Set `NODE_ENV=production`, `CORS_ORIGINS=https://app…`, `NEXT_PUBLIC_API_URL=https://api…`
   (at web build time), and `TRUST_PROXY_HOPS` for your load balancer.
3. Configure a real SMTP provider (`EMAIL_DELIVERY_MODE=smtp`, `SMTP_*`, `EMAIL_FROM` on a domain
   with SPF/DKIM/DMARC) for both the API and the worker.
4. Run `pnpm db:deploy` before starting the new API version.
5. Run a single API instance, or move rate limiting to a shared store first.

## 9. Local e-mail workflow

```bash
pnpm db:up && pnpm mail:up   # PostgreSQL and Mailpit (SMTP :1025, inbox http://localhost:8025)
pnpm db:migrate
pnpm dev
```

Register at <http://localhost:3000/register>, open the inbox at <http://localhost:8025>, and click
the confirmation link; reset e-mails arrive the same way. If Mailpit is not running, registration
answers `503 EMAIL_DELIVERY_FAILED` (it never pretends the mail was sent), and the API logs
"SMTP server is not reachable" at startup.

## 10. Tests

- `pnpm test` — no database needed: schema rules (shared), token/cookie/hasher/user-agent helpers,
  origin check, CORS, rate limiting, and the 401 boundary (API), and forms, guards, the auth
  provider, the user menu, settings, navigation, and theme in jsdom (web).
- `pnpm test:integration` — the API against a real PostgreSQL database named by
  `TEST_DATABASE_URL` (must end in `_test`; created and migrated automatically, tables truncated
  before each test, never the development database). Covers registration, verification, login,
  logout, expiry, revocation, profile isolation, password change and reset, token expiry and
  single use under concurrency, CSRF, origins, rate limits, cross-user session access, and cleanup.

## 11. Known limitations

- No multi-factor authentication, e-mail address change, account deletion, or roles yet.
- Unverified accounts are not deleted automatically; re-registering replaces them.
- Rate limits are per process (§6).
- Background e-mails (resend, reset, change notices) are retried by the user, not queued: if the
  SMTP server is down, the failure is logged and the user can request the link again.
