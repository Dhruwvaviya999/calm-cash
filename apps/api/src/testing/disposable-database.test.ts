import { describe, expect, it } from 'vitest';

import { assertDisposableDatabaseUrl } from './disposable-database';

const DEVELOPMENT = 'postgresql://calmcash:pw@localhost:5433/calmcash';
const TEST = 'postgresql://calmcash:pw@localhost:5433/calmcash_test';

describe('assertDisposableDatabaseUrl', () => {
  it('accepts a dedicated *_test database', () => {
    expect(assertDisposableDatabaseUrl(TEST, DEVELOPMENT)).toBe(TEST);
  });

  it('refuses anything that could be the development database', () => {
    expect(() => assertDisposableDatabaseUrl(undefined, DEVELOPMENT)).toThrow(/not set/);
    expect(() => assertDisposableDatabaseUrl(DEVELOPMENT, DEVELOPMENT)).toThrow(/_test/);
    expect(() => assertDisposableDatabaseUrl(TEST, TEST)).toThrow(/same database/);
    expect(() => assertDisposableDatabaseUrl('not a url', DEVELOPMENT)).toThrow(/valid/);
  });
});
