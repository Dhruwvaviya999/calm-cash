import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { readSessionToken } from './session-cookie';

const CONFIG = { cookieName: 'calmcash_session', secureCookie: false } as const;
const TOKEN = 'abcDEF123_-'.padEnd(43, 'x');

function requestWithCookie(cookie: string | undefined): Pick<Request, 'get'> {
  function get(name: 'set-cookie'): string[] | undefined;
  function get(name: string): string | undefined;
  function get(name: string): string | string[] | undefined {
    return name.toLowerCase() === 'cookie' ? cookie : undefined;
  }
  return { get };
}

describe('readSessionToken', () => {
  it('reads the session cookie among others', () => {
    const header = `theme=dark; calmcash_session=${TOKEN}; a=b`;
    expect(readSessionToken(requestWithCookie(header), CONFIG)).toBe(TOKEN);
  });

  it('ignores missing, malformed, and similarly named cookies', () => {
    expect(readSessionToken(requestWithCookie(undefined), CONFIG)).toBeUndefined();
    expect(readSessionToken(requestWithCookie('calmcash_session=short'), CONFIG)).toBeUndefined();
    expect(
      readSessionToken(requestWithCookie(`xcalmcash_session=${TOKEN}`), CONFIG),
    ).toBeUndefined();
    expect(
      readSessionToken(requestWithCookie(`calmcash_session=${TOKEN}%00`), CONFIG),
    ).toBeUndefined();
  });

  it('uses the first well-formed value when the cookie is repeated', () => {
    const header = `calmcash_session=bad; calmcash_session=${TOKEN}; calmcash_session=${'y'.repeat(43)}`;
    expect(readSessionToken(requestWithCookie(header), CONFIG)).toBe(TOKEN);
  });
});
