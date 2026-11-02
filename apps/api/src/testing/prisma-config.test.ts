import { execFileSync } from 'node:child_process';
import type * as ChildProcess from 'node:child_process';
import type * as FileSystem from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import setupIntegrationDatabase from './integration-global-setup';

// Test configuration without reading local credentials or running database migrations.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  existsSync: () => false,
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: vi.fn(),
}));

const POOLED =
  'postgresql://user:test-password@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
const DIRECT =
  'postgresql://user:test-password@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require';
const LOCAL = 'postgresql://user:test-password@localhost:5433/calmcash';
const TEST = 'postgresql://user:test-password@localhost:5433/calmcash_test';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Prisma CLI connection configuration', () => {
  it.each([
    {
      name: 'explicit direct URL',
      direct: DIRECT,
      unpooled: LOCAL,
      runtime: POOLED,
      expected: DIRECT,
    },
    {
      name: 'Neon integration URL',
      direct: undefined,
      unpooled: DIRECT,
      runtime: POOLED,
      expected: DIRECT,
    },
    {
      name: 'local fallback',
      direct: undefined,
      unpooled: undefined,
      runtime: LOCAL,
      expected: LOCAL,
    },
    { name: 'blank optional URLs', direct: ' ', unpooled: '', runtime: LOCAL, expected: LOCAL },
    {
      name: 'no URL for generation',
      direct: undefined,
      unpooled: undefined,
      runtime: undefined,
      expected: undefined,
    },
    { name: 'all blank URLs', direct: '', unpooled: ' ', runtime: '', expected: undefined },
  ])(
    'uses $name',
    async ({ direct, unpooled, runtime, expected }) => {
      vi.stubEnv('DIRECT_URL', direct);
      vi.stubEnv('DATABASE_URL_UNPOOLED', unpooled);
      vi.stubEnv('DATABASE_URL', runtime);

      const { default: config } = await import('../../../../prisma.config');
      expect(config.datasource?.url).toBe(expected);
    },
    // The first import loads Prisma's config package cold, which can exceed the default 5 s
    // while every workspace's tests run in parallel.
    20_000,
  );
});

it('forces integration migrations to the test database even when production Neon URLs are inherited', () => {
  vi.stubEnv('DATABASE_URL', POOLED);
  vi.stubEnv('DIRECT_URL', DIRECT);
  vi.stubEnv('DATABASE_URL_UNPOOLED', DIRECT);
  vi.stubEnv('TEST_DATABASE_URL', TEST);

  setupIntegrationDatabase();

  expect(execFileSync).toHaveBeenCalledOnce();
  const options = vi.mocked(execFileSync).mock.calls[0]?.[2];
  expect(options?.env).toMatchObject({
    DATABASE_URL: TEST,
    DIRECT_URL: TEST,
    DATABASE_URL_UNPOOLED: TEST,
  });
});
