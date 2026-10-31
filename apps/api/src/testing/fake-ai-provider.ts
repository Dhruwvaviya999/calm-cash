import type { AiProblem } from '@calmcash/shared';

import {
  AiUnavailableError,
  type AiCompletionRequest,
  type AiProvider,
  type AiProviderStatus,
} from '../modules/ai/provider/ai-provider';

// A scripted stand-in for the local model. Tests queue the raw text answers (or failures) the
// "model" gives, in order, and can inspect every request it received. Nothing leaves the process.

export type FakeReply = string | { fail: AiProblem } | ((request: AiCompletionRequest) => string);

export interface FakeAiProvider extends AiProvider {
  readonly requests: AiCompletionRequest[];
  /** Answers given in order; when empty, requests fail as `invalid_output`. */
  replies: FakeReply[];
  /** What `status()` reports (`undefined` problem = ready). */
  problem: AiProblem | undefined;
  /** Queues JSON answers. */
  reply: (...values: unknown[]) => void;
}

export function createFakeAiProvider(model = 'test-model'): FakeAiProvider {
  const fake: FakeAiProvider = {
    model,
    requests: [],
    replies: [],
    problem: undefined,
    reply: (...values) => {
      fake.replies.push(
        ...values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))),
      );
    },
    complete: (request) => {
      fake.requests.push(request);
      const next = fake.replies.shift();
      if (next === undefined) return Promise.reject(new AiUnavailableError('invalid_output'));
      if (typeof next === 'function') return Promise.resolve(next(request));
      if (typeof next === 'object') return Promise.reject(new AiUnavailableError(next.fail));
      return Promise.resolve(next);
    },
    status: (): Promise<AiProviderStatus> =>
      Promise.resolve({
        reachable: fake.problem !== 'unreachable',
        modelInstalled:
          fake.problem === 'unreachable' ? undefined : fake.problem !== 'model_missing',
        checkedAt: new Date(),
        lastSuccessAt: fake.problem === undefined ? new Date() : undefined,
        problem: fake.problem,
      }),
  };
  return fake;
}
