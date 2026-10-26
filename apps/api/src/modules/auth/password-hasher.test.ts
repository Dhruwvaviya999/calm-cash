import { describe, expect, it } from 'vitest';

import { FAST_ARGON2_PARAMETERS } from '../../testing/create-test-app';
import { createArgon2PasswordHasher, DEFAULT_ARGON2_PARAMETERS } from './password-hasher';

const hasher = createArgon2PasswordHasher(FAST_ARGON2_PARAMETERS);
const PASSWORD = 'correct horse battery staple';

describe('Argon2id password hasher', () => {
  it('produces salted Argon2id PHC strings that verify only the right password', async () => {
    const first = await hasher.hash(PASSWORD);
    const second = await hasher.hash(PASSWORD);

    expect(first).toMatch(/^\$argon2id\$v=19\$m=1024,p=1,t=1\$/);
    expect(first).not.toBe(second);
    expect(await hasher.verify(first, PASSWORD)).toBe(true);
    expect(await hasher.verify(first, 'Correct horse battery staple')).toBe(false);
  });

  it('treats unreadable hashes as a failed verification instead of throwing', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
    expect(hasher.needsRehash('not-a-hash')).toBe(true);
  });

  it('flags hashes made with weaker parameters for an upgrade', async () => {
    const weak = await hasher.hash(PASSWORD);
    const production = createArgon2PasswordHasher(DEFAULT_ARGON2_PARAMETERS);

    expect(production.needsRehash(weak)).toBe(true);
    expect(hasher.needsRehash(weak)).toBe(false);
  });

  it('defaults to at least the OWASP-recommended Argon2id parameters', () => {
    expect(DEFAULT_ARGON2_PARAMETERS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(DEFAULT_ARGON2_PARAMETERS.timeCost).toBeGreaterThanOrEqual(2);
  });

  it('spends verification effort for unknown accounts without failing', async () => {
    await expect(hasher.verifyAgainstDummy('whatever')).resolves.toBeUndefined();
  });
});
