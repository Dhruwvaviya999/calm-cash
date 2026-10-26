import { AUTH_TOKEN_PATTERN } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { deriveCsrfToken, digestsEqual, generateToken, hashToken } from './tokens';

describe('authentication tokens', () => {
  it('generates unique 256-bit base64url tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(AUTH_TOKEN_PATTERN);
    }
  });

  it('hashes tokens to lower-case hex SHA-256 digests', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives a CSRF token bound to one session', () => {
    const session = generateToken();
    const csrf = deriveCsrfToken(session);

    expect(csrf).toMatch(AUTH_TOKEN_PATTERN);
    expect(deriveCsrfToken(session)).toBe(csrf);
    expect(deriveCsrfToken(generateToken())).not.toBe(csrf);
    expect(csrf).not.toBe(session);
  });

  it('compares digests in constant time and rejects malformed input', () => {
    const digest = hashToken('value');
    expect(digestsEqual(digest, hashToken('value'))).toBe(true);
    expect(digestsEqual(digest, hashToken('other'))).toBe(false);
    expect(digestsEqual(digest, digest.slice(0, 32))).toBe(false);
    expect(digestsEqual('', '')).toBe(false);
  });
});
