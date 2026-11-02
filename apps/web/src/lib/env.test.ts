import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('public API configuration', () => {
  it.each([undefined, ''])('uses the current origin when the API URL is %s', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', value);
    expect((await import('./env')).publicEnv.apiUrl).toBe('');
  });

  it('supports the separate local development API', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    expect((await import('./env')).publicEnv.apiUrl).toBe('http://localhost:4000');
  });

  it.each(['https://app.example/api/v1', '/api', 'ftp://api.example', 'https://api.example?x=1'])(
    'rejects an API URL that would break routing: %s',
    async (value) => {
      vi.stubEnv('NEXT_PUBLIC_API_URL', value);
      await expect(import('./env')).rejects.toThrow('Invalid public environment configuration');
    },
  );
});
