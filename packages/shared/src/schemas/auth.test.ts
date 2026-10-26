import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../constants/auth';
import {
  authSessionDtoSchema,
  changePasswordInputSchema,
  emailAddressSchema,
  isWeakPassword,
  loginInputSchema,
  newPasswordSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  sessionDtoSchema,
  updateProfileInputSchema,
} from './auth';

const STRONG_PASSWORD = 'correct horse battery staple';
const TOKEN = 'A'.repeat(43);
const TIMESTAMP = '2026-10-25T09:30:00.000Z';

function issuePaths(result: { error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

describe('emailAddressSchema', () => {
  it('trims and lower-cases addresses so they compare consistently', () => {
    expect(emailAddressSchema.parse('  Asha.Rao@Example.COM ')).toBe('asha.rao@example.com');
  });

  it('rejects malformed and oversized addresses', () => {
    expect(emailAddressSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailAddressSchema.safeParse(`${'a'.repeat(250)}@x.io`).success).toBe(false);
    expect(emailAddressSchema.safeParse(42).success).toBe(false);
  });
});

describe('newPasswordSchema', () => {
  it('accepts long passphrases and password-manager output without composition rules', () => {
    expect(newPasswordSchema.safeParse(STRONG_PASSWORD).success).toBe(true);
    expect(newPasswordSchema.safeParse('vT9#qL2!xR7$mK4@pW8&').success).toBe(true);
    expect(newPasswordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH - 1) + 'b').success).toBe(
      true,
    );
  });

  it('enforces the length bounds', () => {
    expect(newPasswordSchema.safeParse('x'.repeat(PASSWORD_MIN_LENGTH - 2) + 'yz').success).toBe(
      true,
    );
    expect(newPasswordSchema.safeParse('short-pass').success).toBe(false);
    expect(newPasswordSchema.safeParse('ab'.repeat(PASSWORD_MAX_LENGTH)).success).toBe(false);
  });

  it('rejects common and single-character passwords', () => {
    expect(isWeakPassword('Password1234')).toBe(true);
    expect(isWeakPassword('zzzzzzzzzzzzzz')).toBe(true);
    expect(newPasswordSchema.safeParse('PASSWORD1234').success).toBe(false);
    expect(isWeakPassword(STRONG_PASSWORD)).toBe(false);
  });

  it('keeps spaces, because they are part of a passphrase', () => {
    expect(newPasswordSchema.parse(`  ${STRONG_PASSWORD}  `)).toBe(`  ${STRONG_PASSWORD}  `);
  });
});

describe('registerInputSchema', () => {
  const valid = {
    name: '  Asha Rao ',
    email: 'Asha@Example.com',
    password: STRONG_PASSWORD,
    passwordConfirmation: STRONG_PASSWORD,
  };

  it('normalises the name and e-mail address', () => {
    expect(registerInputSchema.parse(valid)).toEqual({
      ...valid,
      name: 'Asha Rao',
      email: 'asha@example.com',
    });
  });

  it('reports a mismatched confirmation on the confirmation field', () => {
    const result = registerInputSchema.safeParse({ ...valid, passwordConfirmation: 'different' });
    expect(issuePaths(result)).toEqual(['passwordConfirmation']);
  });

  it('rejects a password equal to the e-mail address', () => {
    const email = 'longer.address@example.com';
    const result = registerInputSchema.safeParse({
      ...valid,
      email,
      password: email,
      passwordConfirmation: email,
    });
    expect(issuePaths(result)).toEqual(['password']);
  });

  it('rejects unknown fields instead of silently accepting them (mass assignment)', () => {
    const result = registerInputSchema.safeParse({ ...valid, emailVerifiedAt: TIMESTAMP });
    expect(result.success).toBe(false);
  });

  it('rejects blank names and control characters', () => {
    expect(issuePaths(registerInputSchema.safeParse({ ...valid, name: '   ' }))).toEqual(['name']);
    expect(issuePaths(registerInputSchema.safeParse({ ...valid, name: 'Asha\u0000' }))).toEqual([
      'name',
    ]);
  });
});

describe('loginInputSchema', () => {
  it('does not apply the new-password policy to existing passwords', () => {
    expect(loginInputSchema.safeParse({ email: 'a@example.com', password: 'old' }).success).toBe(
      true,
    );
    expect(loginInputSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('password change and reset', () => {
  it('requires a new password that differs from the current one', () => {
    const result = changePasswordInputSchema.safeParse({
      currentPassword: STRONG_PASSWORD,
      newPassword: STRONG_PASSWORD,
      newPasswordConfirmation: STRONG_PASSWORD,
    });
    expect(issuePaths(result)).toEqual(['newPassword']);
  });

  it('validates the reset token format', () => {
    const base = { password: STRONG_PASSWORD, passwordConfirmation: STRONG_PASSWORD };
    expect(resetPasswordInputSchema.safeParse({ ...base, token: TOKEN }).success).toBe(true);
    expect(resetPasswordInputSchema.safeParse({ ...base, token: 'short' }).success).toBe(false);
    expect(
      resetPasswordInputSchema.safeParse({ ...base, token: `${TOKEN.slice(0, 42)}=` }).success,
    ).toBe(false);
  });
});

describe('updateProfileInputSchema', () => {
  it('accepts partial updates of the editable fields', () => {
    expect(updateProfileInputSchema.parse({ timezone: 'Europe/London' })).toEqual({
      timezone: 'Europe/London',
    });
  });

  it('rejects empty updates, unsupported values, and protected fields', () => {
    expect(updateProfileInputSchema.safeParse({}).success).toBe(false);
    expect(updateProfileInputSchema.safeParse({ preferredCurrency: 'XYZ' }).success).toBe(false);
    expect(updateProfileInputSchema.safeParse({ timezone: 'Mars/Base' }).success).toBe(false);
    for (const field of ['email', 'id', 'passwordHash', 'emailVerifiedAt']) {
      expect(updateProfileInputSchema.safeParse({ name: 'Asha', [field]: 'x' }).success).toBe(
        false,
      );
    }
  });
});

describe('response schemas', () => {
  const user = {
    id: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e6f',
    name: 'Asha',
    email: 'asha@example.com',
    emailVerifiedAt: TIMESTAMP,
    preferredCurrency: 'INR',
    timezone: 'Asia/Kolkata',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };

  it('parses a session response and strips anything that is not part of the contract', () => {
    const parsed = authSessionDtoSchema.parse({
      user: { ...user, passwordHash: '$argon2id$v=19$...' },
      csrfToken: TOKEN,
      sessionId: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70',
      expiresAt: TIMESTAMP,
      sessionToken: TOKEN,
    });
    expect(parsed.user).not.toHaveProperty('passwordHash');
    expect(parsed).not.toHaveProperty('sessionToken');
  });

  it('describes sessions without any token material', () => {
    const parsed = sessionDtoSchema.parse({
      id: '01920c3e-4f6a-7c3b-9d2e-1a2b3c4d5e70',
      createdAt: TIMESTAMP,
      lastActiveAt: TIMESTAMP,
      expiresAt: TIMESTAMP,
      current: true,
      tokenHash: 'f'.repeat(64),
    });
    expect(parsed).not.toHaveProperty('tokenHash');
    expect(parsed).not.toHaveProperty('deviceLabel');
  });
});
