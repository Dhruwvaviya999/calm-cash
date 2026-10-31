import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AiConfig } from '../../../config/ai-env';
import { AiUnavailableError, type AiCompletionRequest, type AiProvider } from './ai-provider';
import { createLimiter, createOllamaProvider } from './ollama-provider';

const CONFIG: AiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3:1.7b',
  requestTimeoutMs: 5_000,
  maxConcurrent: 1,
  maxQueue: 1,
  contextTokens: 4_096,
  maxOutputTokens: 512,
  maxPromptChars: 2_000,
  disableThinking: true,
  rateLimit: { limit: 30, windowMs: 600_000 },
};

const SECRET_PROMPT = 'Salary from Acme 123456';

const REQUEST: AiCompletionRequest = {
  messages: [
    { role: 'system', content: 'Answer in JSON.' },
    { role: 'user', content: SECRET_PROMPT },
  ],
  jsonSchema: { type: 'object' },
  maxOutputTokens: 100,
  purpose: 'test',
};

const sentBodySchema = z.object({
  model: z.string(),
  stream: z.boolean(),
  format: z.record(z.string(), z.unknown()),
  think: z.boolean().optional(),
  keep_alive: z.string(),
  options: z.object({ temperature: z.number(), num_ctx: z.number(), num_predict: z.number() }),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

interface Call {
  url: string;
  body: z.output<typeof sentBodySchema> | undefined;
}

type Handler = (url: string, init: RequestInit | undefined) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chat(content: string): Response {
  return json({ message: { role: 'assistant', content }, done: true, done_reason: 'stop' });
}

interface Setup {
  provider: AiProvider;
  calls: Call[];
  logs: string[];
}

function setup(handler: Handler, config: Partial<AiConfig> = {}): Setup {
  const calls: Call[] = [];
  const logs: string[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => logs.push(line) });
  const fetchStub = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({
      url,
      body: raw === undefined ? undefined : sentBodySchema.parse(JSON.parse(raw)),
    });
    return handler(url, init);
  };
  const provider = createOllamaProvider({
    config: { ...CONFIG, ...config },
    logger,
    fetch: fetchStub,
  });
  return { provider, calls, logs };
}

async function problemOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error: unknown) {
    return error instanceof AiUnavailableError ? error.problem : 'other';
  }
}

describe('Ollama provider', () => {
  it('sends a bounded, deterministic, non-streaming chat request and returns the text', async () => {
    const { provider, calls, logs } = setup(() => Promise.resolve(chat('{"ok":true}')));

    await expect(provider.complete(REQUEST)).resolves.toBe('{"ok":true}');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0]?.body).toMatchObject({
      model: 'qwen3:1.7b',
      stream: false,
      format: { type: 'object' },
      think: false,
      options: { temperature: 0, num_ctx: 4_096, num_predict: 100 },
    });
    // Logs carry the purpose and timing only — never the prompt or the answer.
    expect(logs.join('')).toContain('"purpose":"test"');
    expect(logs.join('')).not.toContain(SECRET_PROMPT);
    expect(logs.join('')).not.toContain('"ok":true');
  });

  it('never asks for more output tokens than configured', async () => {
    const { provider, calls } = setup(() => Promise.resolve(chat('{}')), { maxOutputTokens: 64 });

    await provider.complete({ ...REQUEST, maxOutputTokens: 5_000 });

    expect(calls[0]?.body?.options.num_predict).toBe(64);
  });

  it('drops the thinking switch once for a model that does not support it', async () => {
    let attempt = 0;
    const { provider, calls } = setup(() => {
      attempt += 1;
      return Promise.resolve(
        attempt === 1 ? json({ error: 'model does not support thinking' }, 400) : chat('{}'),
      );
    });

    await provider.complete(REQUEST);
    await provider.complete(REQUEST);

    expect(calls.map((call) => call.body?.think)).toEqual([false, undefined, undefined]);
  });

  it('reports a missing model, an unreachable server, and unreadable replies', async () => {
    expect(
      await problemOf(
        setup(() => Promise.resolve(json({ error: 'model not found' }, 404))).provider.complete(
          REQUEST,
        ),
      ),
    ).toBe('model_missing');
    expect(
      await problemOf(
        setup(() => Promise.reject(new TypeError('fetch failed'))).provider.complete(REQUEST),
      ),
    ).toBe('unreachable');
    expect(
      await problemOf(
        setup(() => Promise.resolve(json({ error: 'boom' }, 500))).provider.complete(REQUEST),
      ),
    ).toBe('unreachable');
    expect(
      await problemOf(
        setup(() => Promise.resolve(json({ unexpected: true }))).provider.complete(REQUEST),
      ),
    ).toBe('invalid_output');
  });

  it('gives up after the request timeout', async () => {
    const { provider } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'),
            );
          });
        }),
      { requestTimeoutMs: 50 },
    );

    expect(await problemOf(provider.complete(REQUEST))).toBe('timeout');
  });

  it('refuses an oversized prompt without sending it', async () => {
    const { provider, calls } = setup(() => Promise.resolve(chat('{}')));

    const huge = { ...REQUEST, messages: [{ role: 'user' as const, content: 'x'.repeat(2_001) }] };

    expect(await problemOf(provider.complete(huge))).toBe('invalid_output');
    expect(calls).toHaveLength(0);
  });

  it('reports the server busy instead of piling up requests', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { provider } = setup(async () => {
      await gate;
      return chat('{}');
    });

    const first = provider.complete(REQUEST);
    const second = provider.complete(REQUEST); // queued (maxQueue 1)
    const third = provider.complete(REQUEST); // refused

    expect(await problemOf(third)).toBe('busy');
    release?.();
    await expect(first).resolves.toBe('{}');
    await expect(second).resolves.toBe('{}');
  });

  it('checks the server and model through /api/tags and caches the answer briefly', async () => {
    const { provider, calls } = setup((url) =>
      Promise.resolve(
        url.endsWith('/api/tags')
          ? json({ models: [{ name: 'qwen3:1.7b' }, { name: 'llama3.2:latest' }] })
          : chat('{}'),
      ),
    );

    const status = await provider.status();
    await provider.status();

    expect(status).toMatchObject({ reachable: true, modelInstalled: true, problem: undefined });
    expect(calls.filter((call) => call.url.endsWith('/api/tags'))).toHaveLength(1);
  });

  it('reports a model that is not pulled and a server that is down', async () => {
    const missing = setup(() => Promise.resolve(json({ models: [{ name: 'llama3.2:latest' }] })));
    expect(await missing.provider.status()).toMatchObject({
      reachable: true,
      modelInstalled: false,
      problem: 'model_missing',
    });

    const down = setup(() => Promise.reject(new TypeError('connect ECONNREFUSED')));
    expect(await down.provider.status()).toMatchObject({
      reachable: false,
      modelInstalled: undefined,
      problem: 'unreachable',
    });
  });

  it('matches an untagged model name against :latest', async () => {
    const { provider } = setup(() => Promise.resolve(json({ models: [{ name: 'phi4:latest' }] })), {
      model: 'phi4',
    });

    expect((await provider.status()).modelInstalled).toBe(true);
  });
});

describe('createLimiter', () => {
  it('runs at most the configured number of tasks at once', async () => {
    const limiter = createLimiter(2, 5);
    let running = 0;
    let peak = 0;
    const task = async (): Promise<void> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };

    await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));

    expect(peak).toBe(2);
    expect(limiter.active()).toBe(0);
    expect(limiter.queued()).toBe(0);
  });

  it('frees the slot when a task fails', async () => {
    const limiter = createLimiter(1, 0);

    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});
