// Authentication rules shared by the API (enforcement) and the web app (inline guidance).

/**
 * Password length policy. No composition rules: long passphrases and password-manager output are
 * welcome, and the upper bound only exists to keep hashing cost predictable.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A small deny-list of passwords that satisfy the length rule but are guessed first by attackers.
 * Compared case-insensitively. The API remains the authority; this list only catches the obvious.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789abc',
  '1q2w3e4r5t6y',
  'abc123456789',
  'abcdefghijkl',
  'administrator',
  'calmcash1234',
  'calmcashcalmcash',
  'iloveyou1234',
  'letmein12345',
  'password1234',
  'password123!',
  'password12345',
  'passwordpassword',
  'qwerty123456',
  'qwertyuiop12',
  'qwertyuiopasdf',
  'welcome12345',
];

/**
 * E-mailed verification and password-reset tokens, and session tokens: 32 random bytes encoded
 * as unpadded base64url (43 characters).
 */
export const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** How long e-mailed links stay valid. Shown to users, enforced by the API. */
export const EMAIL_VERIFICATION_TOKEN_TTL_HOURS = 24;
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
