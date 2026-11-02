import { describe, expect, it } from 'vitest';

import { isPrivateAiHost } from './ai-env';
import { parseEnv } from './env';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://calmcash:local-secret@localhost:5432/calmcash',
  CORS_ORIGINS: 'http://localhost:3000',
} as const;

function issuesOf(result: ReturnType<typeof parseEnv>): string {
  return result.success ? '' : result.issues.join('\n');
}

describe('isPrivateAiHost', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
    '10.0.0.5',
    '172.20.1.1',
    '192.168.1.20',
    '169.254.10.1',
    'ollama',
    'gpu-box.local',
    'ollama.internal',
    'fd12:3456::1',
  ])('accepts %s', (host) => {
    expect(isPrivateAiHost(host)).toBe(true);
  });

  it.each(['api.openai.com', 'ollama.example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1'])(
    'rejects %s',
    (host) => {
      expect(isPrivateAiHost(host)).toBe(false);
    },
  );
});

describe('AI environment', () => {
  it('accepts a self-hosted Ollama on the private network and its limits', () => {
    const result = parseEnv({
      ...VALID_ENV,
      OLLAMA_BASE_URL: 'http://ollama:11434',
      OLLAMA_MODEL: 'qwen3:4b-instruct',
      OLLAMA_MAX_CONCURRENT_REQUESTS: '2',
      AI_MAX_REQUESTS_PER_USER: '5',
      AI_RATE_WINDOW_MINUTES: '2',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.ai).toMatchObject({
      baseUrl: 'http://ollama:11434',
      model: 'qwen3:4b-instruct',
      maxConcurrent: 2,
      rateLimit: { limit: 5, windowMs: 120_000 },
    });
  });

  it('refuses a hosted AI endpoint: financial data stays local', () => {
    const result = parseEnv({ ...VALID_ENV, OLLAMA_BASE_URL: 'https://ollama.example.com' });

    expect(issuesOf(result)).toContain('OLLAMA_BASE_URL');
    expect(issuesOf(result)).toContain('self-hosted');
  });

  it('refuses paths, credentials, and non-http schemes in the Ollama URL', () => {
    expect(
      issuesOf(parseEnv({ ...VALID_ENV, OLLAMA_BASE_URL: 'http://127.0.0.1:11434/api' })),
    ).toContain('bare origin');
    const withCredentials = issuesOf(
      parseEnv({ ...VALID_ENV, OLLAMA_BASE_URL: 'http://user:pw@127.0.0.1:11434' }),
    );
    expect(withCredentials).toContain('bare origin');
    expect(withCredentials).not.toContain('pw@');
    expect(issuesOf(parseEnv({ ...VALID_ENV, OLLAMA_BASE_URL: 'file:///etc/passwd' }))).toContain(
      'OLLAMA_BASE_URL',
    );
  });

  it('rejects odd model names and out-of-range limits', () => {
    const issues = issuesOf(
      parseEnv({
        ...VALID_ENV,
        OLLAMA_MODEL: 'qwen3; rm -rf /',
        OLLAMA_MAX_CONCURRENT_REQUESTS: '0',
        OLLAMA_REQUEST_TIMEOUT_MS: '10',
        AI_ENABLED: 'yes',
      }),
    );

    expect(issues).toContain('OLLAMA_MODEL');
    expect(issues).toContain('OLLAMA_MAX_CONCURRENT_REQUESTS');
    expect(issues).toContain('OLLAMA_REQUEST_TIMEOUT_MS');
    expect(issues).toContain('AI_ENABLED');
  });

  it('can be switched off by the operator', () => {
    const result = parseEnv({ ...VALID_ENV, AI_ENABLED: 'false' });

    expect(result.success && result.config.ai.enabled).toBe(false);
  });
});
