import { z } from 'zod';

import { optionalString } from './email-env';

// Local AI configuration (Phase 10). CalmCash talks to an Ollama server the operator runs —
// on this machine or a private network — and never to a hosted AI service: a base URL on a public
// host is refused at start-up, and there is no fallback provider. AI is optional; with it off or
// unreachable every other feature works unchanged.

export interface AiConfig {
  /** `AI_ENABLED`: the operator's master switch. */
  enabled: boolean;
  /** Origin of the Ollama HTTP API (never sent to browsers). */
  baseUrl: string;
  model: string;
  /** Upper bound of one inference request, model loading included. */
  requestTimeoutMs: number;
  /** Inference requests running at once (local models are CPU/GPU-bound). */
  maxConcurrent: number;
  /** Requests waiting for a slot before new ones are refused as busy. */
  maxQueue: number;
  /** Context window requested from the model (`num_ctx`). */
  contextTokens: number;
  /** Output limit per request (`num_predict`). */
  maxOutputTokens: number;
  /** Upper bound of the characters in one prompt (all messages). */
  maxPromptChars: number;
  /** Ask reasoning models to answer without a visible thinking phase. */
  disableThinking: boolean;
  /** AI requests per signed-in user per window. */
  rateLimit: { limit: number; windowMs: number };
}

export const DEFAULT_OLLAMA_MODEL = 'qwen3:1.7b';

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

/**
 * Hosts that cannot be a public AI service: loopback, private IPv4 ranges, `localhost`, single-label
 * names (a container such as `ollama`), and `*.local` / `*.internal` names.
 */
export function isPrivateAiHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
  if (PRIVATE_IPV4.some((pattern) => pattern.test(host))) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('fe80:')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  return host.endsWith('.local') || host.endsWith('.internal');
}

const booleanFlag = (fallback: boolean): z.ZodType<boolean, string | undefined> =>
  z
    .enum(['true', 'false'], { error: 'Must be "true" or "false".' })
    .optional()
    .transform((value) => (value === undefined ? fallback : value === 'true'));

/** Zod fields of the AI variables; merged into the API's environment schema. */
export const aiEnvFields = {
  AI_ENABLED: booleanFlag(true),
  OLLAMA_BASE_URL: optionalString.pipe(
    z
      .url({
        protocol: /^https?$/,
        error: 'Must be an http(s) URL such as http://127.0.0.1:11434.',
      })
      .optional(),
  ),
  OLLAMA_MODEL: optionalString.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,100}$/, 'Use an Ollama model name such as qwen3:1.7b.')
      .optional(),
  ),
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
  OLLAMA_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(8).default(1),
  OLLAMA_MAX_QUEUED_REQUESTS: z.coerce.number().int().min(0).max(50).default(4),
  OLLAMA_CONTEXT_TOKENS: z.coerce.number().int().min(1_024).max(32_768).default(4_096),
  OLLAMA_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4_096).default(512),
  OLLAMA_DISABLE_THINKING: booleanFlag(true),
  AI_MAX_PROMPT_CHARS: z.coerce.number().int().min(2_000).max(60_000).default(12_000),
  AI_MAX_REQUESTS_PER_USER: z.coerce.number().int().min(1).max(1_000).default(30),
  AI_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(10),
};

export interface AiEnv {
  AI_ENABLED: boolean;
  OLLAMA_BASE_URL?: string | undefined;
  OLLAMA_MODEL?: string | undefined;
  OLLAMA_REQUEST_TIMEOUT_MS: number;
  OLLAMA_MAX_CONCURRENT_REQUESTS: number;
  OLLAMA_MAX_QUEUED_REQUESTS: number;
  OLLAMA_CONTEXT_TOKENS: number;
  OLLAMA_MAX_OUTPUT_TOKENS: number;
  OLLAMA_DISABLE_THINKING: boolean;
  AI_MAX_PROMPT_CHARS: number;
  AI_MAX_REQUESTS_PER_USER: number;
  AI_RATE_WINDOW_MINUTES: number;
}

interface IssueSink {
  addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void;
}

export function checkAiEnv(env: AiEnv, context: IssueSink): void {
  if (env.OLLAMA_BASE_URL !== undefined) {
    const url = new URL(env.OLLAMA_BASE_URL);
    if (!isPrivateAiHost(url.hostname)) {
      context.addIssue({
        code: 'custom',
        path: ['OLLAMA_BASE_URL'],
        message:
          'Must point at a self-hosted Ollama on this machine or a private network. Hosted AI services are not supported: financial data stays local.',
      });
    }
    if (url.pathname !== '/' || url.search !== '' || url.username !== '' || url.password !== '') {
      context.addIssue({
        code: 'custom',
        path: ['OLLAMA_BASE_URL'],
        message: 'Use the bare origin (no path, query, or credentials).',
      });
    }
  }
}

export function toAiConfig(env: AiEnv): AiConfig {
  return {
    enabled: env.AI_ENABLED,
    baseUrl: new URL(env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').origin,
    model: env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
    requestTimeoutMs: env.OLLAMA_REQUEST_TIMEOUT_MS,
    maxConcurrent: env.OLLAMA_MAX_CONCURRENT_REQUESTS,
    maxQueue: env.OLLAMA_MAX_QUEUED_REQUESTS,
    contextTokens: env.OLLAMA_CONTEXT_TOKENS,
    maxOutputTokens: env.OLLAMA_MAX_OUTPUT_TOKENS,
    maxPromptChars: env.AI_MAX_PROMPT_CHARS,
    disableThinking: env.OLLAMA_DISABLE_THINKING,
    rateLimit: {
      limit: env.AI_MAX_REQUESTS_PER_USER,
      windowMs: env.AI_RATE_WINDOW_MINUTES * 60_000,
    },
  };
}
