import { describe, expect, it } from 'vitest';

import { parseEnv } from './env';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://calmcash:local-secret@localhost:5432/calmcash',
  CORS_ORIGINS: 'http://localhost:3000',
} as const;

describe('parseEnv', () => {
  it('applies documented defaults for optional variables', () => {
    const result = parseEnv(VALID_ENV);

    expect(result).toEqual({
      success: true,
      config: {
        nodeEnv: 'development',
        host: 'localhost',
        port: 4000,
        databaseUrl: VALID_ENV.DATABASE_URL,
        corsOrigins: ['http://localhost:3000'],
        jsonBodyLimit: '100kb',
        logLevel: 'info',
        shutdownTimeoutMs: 10_000,
      },
    });
  });

  it('parses typed values and comma-separated origins', () => {
    const result = parseEnv({
      ...VALID_ENV,
      NODE_ENV: 'production',
      API_PORT: '8080',
      CORS_ORIGINS: 'https://app.calmcash.example, https://admin.calmcash.example',
    });

    expect(result.success && result.config.port).toBe(8080);
    expect(result.success && result.config.corsOrigins).toEqual([
      'https://app.calmcash.example',
      'https://admin.calmcash.example',
    ]);
  });

  it('reports every missing required variable by name', () => {
    const result = parseEnv({});

    expect(result.success).toBe(false);
    const issues = result.success ? '' : result.issues.join('\n');
    expect(issues).toContain('DATABASE_URL');
    expect(issues).toContain('CORS_ORIGINS');
  });

  it('rejects invalid values without echoing them back', () => {
    const secret = 'SuperSecretPassword123';
    const result = parseEnv({
      DATABASE_URL: `mysql://calmcash:${secret}@localhost:3306/calmcash`,
      CORS_ORIGINS: 'http://localhost:3000/dashboard',
      API_PORT: '99999',
      LOG_LEVEL: 'verbose',
    });

    expect(result.success).toBe(false);
    const issues = result.success ? '' : result.issues.join('\n');
    expect(issues).toContain('DATABASE_URL');
    expect(issues).toContain('CORS_ORIGINS');
    expect(issues).toContain('API_PORT');
    expect(issues).toContain('LOG_LEVEL');
    expect(issues).not.toContain(secret);
  });
});
