import { describe, expect, it } from 'vitest';

import { buildLoginHref, getSafeReturnPath, parseLoginNotice } from './return-to';

describe('getSafeReturnPath', () => {
  it('keeps exact in-app destinations', () => {
    expect(getSafeReturnPath('/budgets')).toBe('/budgets');
    expect(getSafeReturnPath('/settings')).toBe('/settings');
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/budgets?x=https://evil.example',
    '/budgets/../../evil',
    '%2F%2Fevil.example',
    '/login',
    ' /budgets',
  ])('falls back to the dashboard for %j', (value) => {
    expect(getSafeReturnPath(value)).toBe('/dashboard');
  });
});

describe('buildLoginHref', () => {
  it('carries a known destination and a notice', () => {
    expect(buildLoginHref({ returnTo: '/transactions' })).toBe('/login?next=%2Ftransactions');
    expect(buildLoginHref({ returnTo: '/accounts', notice: 'session-ended' })).toBe(
      '/login?next=%2Faccounts&notice=session-ended',
    );
  });

  it('drops unknown destinations and the default one', () => {
    expect(buildLoginHref({ returnTo: 'https://evil.example' })).toBe('/login');
    expect(buildLoginHref({ returnTo: '/dashboard' })).toBe('/login');
    expect(buildLoginHref({ notice: 'signed-out' })).toBe('/login?notice=signed-out');
  });
});

describe('parseLoginNotice', () => {
  it('accepts only known notices', () => {
    expect(parseLoginNotice('signed-out')).toBe('signed-out');
    expect(parseLoginNotice('<script>')).toBeUndefined();
    expect(parseLoginNotice(null)).toBeUndefined();
  });
});
