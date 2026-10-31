import { describe, expect, it } from 'vitest';

import { parseWorkerEnv } from './worker-env';

const BASE = {
  DATABASE_URL: 'postgresql://calmcash:local-secret@localhost:5432/calmcash',
  CORS_ORIGINS: 'http://localhost:3000',
} as const;

function issuesOf(result: ReturnType<typeof parseWorkerEnv>): string {
  return result.success ? '' : result.issues.join('\n');
}

describe('parseWorkerEnv', () => {
  it('reads the shared .env with bounded worker defaults', () => {
    const result = parseWorkerEnv(BASE);
    expect(result).toMatchObject({
      success: true,
      config: {
        nodeEnv: 'development',
        webAppUrl: 'http://localhost:3000',
        worker: {
          id: undefined,
          pollIntervalMs: 5_000,
          batchSize: 20,
          leaseMs: 120_000,
          schedulerIntervalMs: 300_000,
          dailyReviewHour: 8,
          health: undefined,
        },
      },
    });
  });

  it('prefers WEB_APP_URL and enables the health endpoint on request', () => {
    const result = parseWorkerEnv({
      ...BASE,
      WEB_APP_URL: 'http://localhost:3100',
      WORKER_HEALTH_PORT: '4300',
      WORKER_ID: 'worker-a',
    });
    expect(result.success && result.config.webAppUrl).toBe('http://localhost:3100');
    expect(result.success && result.config.worker.health).toEqual({
      host: '127.0.0.1',
      port: 4300,
    });
    expect(result.success && result.config.worker.id).toBe('worker-a');
  });

  it('rejects unbounded or unsafe settings by variable name only', () => {
    const issues = issuesOf(
      parseWorkerEnv({
        ...BASE,
        WORKER_BATCH_SIZE: '100000',
        WORKER_LEASE_MS: '10',
        WORKER_DAILY_REVIEW_HOUR: '24',
        WORKER_HEALTH_PORT: 'abc',
        WORKER_ID: 'has spaces and; semicolons',
      }),
    );
    for (const name of [
      'WORKER_BATCH_SIZE',
      'WORKER_LEASE_MS',
      'WORKER_DAILY_REVIEW_HOUR',
      'WORKER_HEALTH_PORT',
      'WORKER_ID',
    ]) {
      expect(issues).toContain(name);
    }
    expect(issues).not.toContain('local-secret');
  });

  it('needs a web app origin for e-mail links, https in production', () => {
    expect(issuesOf(parseWorkerEnv({ DATABASE_URL: BASE.DATABASE_URL }))).toContain('WEB_APP_URL');
    expect(
      issuesOf(
        parseWorkerEnv({
          ...BASE,
          NODE_ENV: 'production',
          EMAIL_DELIVERY_MODE: 'disabled',
        }),
      ),
    ).toContain('WEB_APP_URL: Production links must use https.');
  });
});
