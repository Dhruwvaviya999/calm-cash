import type {
  AiProblem,
  AiStatusDto,
  AssistantLinkTarget,
  TransactionLinkFilters,
} from '@calmcash/shared';
import type Link from 'next/link';
import type { ComponentProps } from 'react';

// Words and destinations for the AI features. Links are built from identifiers in the API's
// validated answer, so they always stay inside CalmCash and use the pages' ordinary URLs.

export type AppHref = ComponentProps<typeof Link>['href'];

/** Why AI help is not available right now, in plain words (never a technical error). */
export function describeAiProblem(problem: AiProblem, model: string): string {
  switch (problem) {
    case 'disabled_by_server':
      return 'AI features are switched off for this CalmCash installation.';
    case 'disabled_by_user':
      return 'You switched AI features off. You can turn them back on in Settings.';
    case 'unreachable':
      return 'The local AI service (Ollama) is not running, so the assistant cannot answer right now.';
    case 'model_missing':
      return `The AI model “${model}” is not installed in Ollama yet.`;
    case 'busy':
      return 'The assistant is busy with other questions. Please try again in a moment.';
    case 'timeout':
      return 'The assistant took too long to answer. Please try again.';
    case 'invalid_output':
      return 'The assistant could not produce a usable answer. Please try again.';
  }
}

/** A short status line for Settings and headers. */
export function describeAiStatus(status: AiStatusDto): string {
  if (status.available) return `Ready — answering with ${status.model} on your own computer.`;
  return describeAiProblem(status.problem ?? 'unreachable', status.model);
}

function transactionsQuery(filters: TransactionLinkFilters): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value !== '') query[key] = value;
  }
  return query;
}

/** Where an assistant link leads: the same URLs the pages themselves use. */
export function assistantHref(target: AssistantLinkTarget): AppHref {
  switch (target.kind) {
    case 'transactions':
      return { pathname: '/transactions', query: transactionsQuery(target.filters) };
    case 'transaction':
      return { pathname: '/transactions', query: { transaction: target.transactionId } };
    case 'dashboard':
      return {
        pathname: '/dashboard',
        query: {
          period: target.period,
          ...(target.from === undefined ? {} : { from: target.from }),
          ...(target.to === undefined ? {} : { to: target.to }),
          ...(target.currency === undefined ? {} : { currency: target.currency }),
        },
      };
    case 'budget':
      return { pathname: '/budgets', query: { budget: target.budgetId } };
    case 'budgets':
      return '/budgets';
    case 'accounts':
      return '/accounts';
    case 'recurring':
      return { pathname: '/budgets', query: { section: 'recurring' } };
    case 'subscriptions':
      return { pathname: '/budgets', query: { section: 'subscriptions' } };
    case 'goals':
      return { pathname: '/budgets', query: { section: 'goals' } };
    case 'insights':
      return '/insights';
    case 'scenarios':
      return '/scenarios';
  }
}

/** Questions offered in an empty conversation. */
export const SUGGESTED_QUESTIONS = [
  'Where did my money go this month?',
  'Compare this month with last month.',
  'Am I over budget anywhere?',
  'Which subscriptions cost me the most?',
  'What payments are coming up?',
  'How much did I spend on food last month?',
  'How much might I have at the end of this month?',
] as const;
