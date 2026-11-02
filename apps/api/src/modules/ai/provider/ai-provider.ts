import type { AiProblem } from '@calmcash/shared';

// The provider boundary: everything CalmCash asks a language model goes through this interface,
// so the rest of the code never knows which runtime answers (Ollama in this phase). Providers only
// return raw text; callers validate it (`structured.ts`) before anything else sees it.

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  messages: readonly AiChatMessage[];
  /** JSON Schema the answer must follow (constrained decoding where the runtime supports it). */
  jsonSchema: Record<string, unknown>;
  /** Lower than the configured maximum for short answers. */
  maxOutputTokens?: number;
  /** Short label for logs (never the prompt). */
  purpose: string;
  signal?: AbortSignal | undefined;
}

export interface AiProviderStatus {
  reachable: boolean;
  /** Unknown while the server cannot be reached. */
  modelInstalled: boolean | undefined;
  checkedAt: Date;
  lastSuccessAt: Date | undefined;
  problem: AiProblem | undefined;
}

export interface AiProvider {
  readonly model: string;
  /** Raw text of the model's answer (expected to be JSON); rejects with `AiUnavailableError`. */
  complete: (request: AiCompletionRequest) => Promise<string>;
  /** Reachability and model availability; cached briefly, never rejects. */
  status: (options?: { refresh?: boolean }) => Promise<AiProviderStatus>;
}

/** The model could not produce a usable answer; `problem` says why (safe to show). */
export class AiUnavailableError extends Error {
  override readonly name = 'AiUnavailableError';
  readonly problem: AiProblem;

  constructor(problem: AiProblem, options: { cause?: unknown } = {}) {
    super(`AI is unavailable: ${problem}.`, { cause: options.cause });
    this.problem = problem;
  }
}

/** Words for each problem, for API errors and the UI. */
export const AI_PROBLEM_MESSAGES: Readonly<Record<AiProblem, string>> = {
  disabled_by_server: 'AI features are turned off on this CalmCash server.',
  disabled_by_user: 'AI features are turned off in your settings.',
  unreachable: 'The local AI service is not running. Everything else in CalmCash still works.',
  model_missing: 'The configured AI model is not installed on the local AI service.',
  busy: 'The local AI service is busy with other requests. Try again in a moment.',
  timeout: 'The local AI service took too long to answer. Try again, or ask a shorter question.',
  invalid_output: 'The AI answer could not be checked, so it was not used. Try rephrasing.',
};
