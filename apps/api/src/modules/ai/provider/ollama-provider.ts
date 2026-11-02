import { z } from 'zod';

import type { AiConfig } from '../../../config/ai-env';
import type { Logger } from '../../../lib/logger';
import {
  AiUnavailableError,
  type AiCompletionRequest,
  type AiProvider,
  type AiProviderStatus,
} from './ai-provider';

// Ollama over its HTTP API (`/api/chat`, `/api/tags`), from the API process only. Requests are
// non-streaming, deterministic (temperature 0), bounded in prompt size, output tokens, and time,
// and limited to `maxConcurrent` at once with a short queue; beyond it new requests are refused
// as busy instead of piling up. Prompts and answers are never logged.

const chatResponseSchema = z.object({
  message: z.object({ role: z.string(), content: z.string() }),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
});

const tagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string(), model: z.string().optional() })),
});

const errorBodySchema = z.object({ error: z.string() });

const STATUS_CACHE_MS = 30_000;
const STATUS_TIMEOUT_MS = 3_000;

export interface OllamaProviderOptions {
  config: AiConfig;
  logger: Logger;
  /** Injectable for tests (defaults to the global `fetch`). */
  fetch?: typeof fetch;
  now?: () => Date;
}

/** A counting semaphore with a bounded queue. */
export function createLimiter(
  maxConcurrent: number,
  maxQueue: number,
): {
  run: <T>(task: () => Promise<T>) => Promise<T>;
  active: () => number;
  queued: () => number;
} {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    active -= 1;
    const next = waiting.shift();
    if (next !== undefined) {
      active += 1;
      next();
    }
  };
  return {
    run: async (task) => {
      if (active >= maxConcurrent) {
        if (waiting.length >= maxQueue) {
          throw new AiUnavailableError('busy');
        }
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      } else {
        active += 1;
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
    active: () => active,
    queued: () => waiting.length,
  };
}

function modelMatches(installed: string, configured: string): boolean {
  const withTag = configured.includes(':') ? configured : `${configured}:latest`;
  return installed === configured || installed === withTag;
}

export function createOllamaProvider({
  config,
  logger,
  fetch: fetchImpl = fetch,
  now = (): Date => new Date(),
}: OllamaProviderOptions): AiProvider {
  const limiter = createLimiter(config.maxConcurrent, config.maxQueue);
  let lastSuccessAt: Date | undefined;
  let cached: AiProviderStatus | undefined;
  let sendThink = config.disableThinking;

  const checkStatus = async (): Promise<AiProviderStatus> => {
    const checkedAt = now();
    try {
      const response = await fetchImpl(`${config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          reachable: false,
          modelInstalled: undefined,
          checkedAt,
          lastSuccessAt,
          problem: 'unreachable',
        };
      }
      const tags = tagsResponseSchema.parse(await response.json());
      const installed = tags.models.some((entry) => modelMatches(entry.name, config.model));
      lastSuccessAt = checkedAt;
      return {
        reachable: true,
        modelInstalled: installed,
        checkedAt,
        lastSuccessAt,
        problem: installed ? undefined : 'model_missing',
      };
    } catch {
      return {
        reachable: false,
        modelInstalled: undefined,
        checkedAt,
        lastSuccessAt,
        problem: 'unreachable',
      };
    }
  };

  const post = async (request: AiCompletionRequest, think: boolean): Promise<Response> => {
    const signals = [AbortSignal.timeout(config.requestTimeoutMs)];
    if (request.signal !== undefined) signals.push(request.signal);
    return fetchImpl(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any(signals),
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        stream: false,
        format: request.jsonSchema,
        ...(think ? { think: false } : {}),
        keep_alive: '10m',
        options: {
          temperature: 0,
          num_ctx: config.contextTokens,
          num_predict: Math.min(
            request.maxOutputTokens ?? config.maxOutputTokens,
            config.maxOutputTokens,
          ),
        },
      }),
    });
  };

  const complete = async (request: AiCompletionRequest): Promise<string> => {
    const promptChars = request.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (promptChars > config.maxPromptChars) {
      // Callers bound their context; reaching this is a programming error, never sent anyway.
      throw new AiUnavailableError('invalid_output');
    }
    const started = Date.now();
    return limiter.run(async () => {
      try {
        let response = await post(request, sendThink);
        if (response.status === 400 && sendThink) {
          const body = errorBodySchema.safeParse(
            await response
              .clone()
              .json()
              .catch(() => ({})),
          );
          if (body.success && /think/i.test(body.data.error)) {
            // This model has no thinking switch; never send it again.
            sendThink = false;
            response = await post(request, false);
          }
        }
        if (response.status === 404) {
          throw new AiUnavailableError('model_missing');
        }
        if (!response.ok) {
          throw new AiUnavailableError('unreachable');
        }
        const parsed = chatResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new AiUnavailableError('invalid_output');
        }
        lastSuccessAt = now();
        logger.info(
          {
            purpose: request.purpose,
            durationMs: Date.now() - started,
            promptChars,
            doneReason: parsed.data.done_reason,
          },
          'AI request completed',
        );
        return parsed.data.message.content;
      } catch (error: unknown) {
        if (error instanceof AiUnavailableError) {
          logger.warn({ purpose: request.purpose, problem: error.problem }, 'AI request failed');
          throw error;
        }
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        const problem = timedOut ? 'timeout' : 'unreachable';
        logger.warn({ purpose: request.purpose, problem }, 'AI request failed');
        throw new AiUnavailableError(problem, { cause: error });
      }
    });
  };

  return {
    model: config.model,
    complete,
    status: async ({ refresh = false } = {}) => {
      const fresh =
        cached !== undefined && now().getTime() - cached.checkedAt.getTime() < STATUS_CACHE_MS;
      // While the model is answering, the server is evidently up: on a CPU-only machine a probe
      // could time out then, and must not turn "busy" into "unreachable".
      const answering = limiter.active() > 0 && cached?.problem === undefined;
      if (cached !== undefined && !refresh && (fresh || answering)) {
        return { ...cached, lastSuccessAt };
      }
      const checked = await checkStatus();
      if (checked.problem === 'unreachable' && answering && cached !== undefined) {
        return { ...cached, lastSuccessAt };
      }
      cached = checked;
      return cached;
    },
  };
}
