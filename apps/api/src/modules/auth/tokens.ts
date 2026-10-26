import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits from the operating system's CSPRNG. */
const TOKEN_BYTES = 32;

/** Domain-separation label for deriving a session's CSRF token from its secret. */
const CSRF_DERIVATION_LABEL = 'calmcash:csrf-token:v1';

/** A new opaque token: 32 random bytes as unpadded base64url (43 characters). */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Lower-case hex SHA-256 of a token. Tokens are 256-bit random values, so a fast hash is enough to
 * make stored values useless to someone who reads the database (no salt or stretching needed).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The session's CSRF (synchronizer) token: HMAC-SHA-256 keyed with the session secret. It is
 * unpredictable without the HttpOnly cookie, bound to exactly one session, and rotates whenever
 * the session does. Deriving it lets the current-session endpoint hand it out again after a page
 * reload while the database keeps only its hash.
 */
export function deriveCsrfToken(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update(CSRF_DERIVATION_LABEL).digest('base64url');
}

/** Constant-time comparison of two hex digests. */
export function digestsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
