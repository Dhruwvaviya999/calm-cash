import {
  AI_LIMITS,
  AI_TOOL_NAMES,
  calendarDateInTimeZone,
  type AssistantBlockDto,
  type AssistantLinkDto,
  type AssistantOutcome,
} from '@calmcash/shared';
import { z } from 'zod';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import type { CategorizedExample, MessageRecord, NewMessage } from './ai.repository';
import { draftFromText, readsLikeRecord } from './drafts';
import { isGrounded, sanitizeWording } from './grounding';
import { narrate } from './narration';
import { DATA_RULES, dataBlock, neutralize } from './prompting';
import { AI_PROBLEM_MESSAGES, AiUnavailableError, type AiProvider } from './provider/ai-provider';
import { generateStructured } from './provider/structured';
import {
  runTool,
  TOOL_DESCRIPTIONS,
  toolCallPlanSchema,
  type ToolCallPlan,
  type ToolContext,
  type ToolOutcome,
} from './tools';

// One assistant turn. (1) The model *plans*: it may only name tools from the allowlist, with plain
// fields — no identifiers, SQL, paths, or URLs exist in its vocabulary. (2) The server validates
// the plan, drops anything unknown, and runs at most three tools as the session's user. (3) Every
// figure shown is built by the server from those tools' results. (4) The model words a short
// answer from the facts' text, and the grounding check rejects any number not in them. A request
// to record money produces a draft for the entry form, never a transaction.

const planSchema = z.object({
  action: z
    .enum(['use_tools', 'record_transaction', 'clarify', 'unsupported'])
    .describe(
      'use_tools for questions about their money; record_transaction when they describe money already spent, received, or moved; clarify only when nothing can be answered; unsupported for anything else.',
    ),
  calls: z.array(toolCallPlanSchema).max(AI_LIMITS.toolCallsPerQuestion),
  question: z.string().max(300).nullish().describe('clarify only: one short question back.'),
});

type Plan = z.output<typeof planSchema>;

export const SUGGESTED_QUESTIONS = [
  'Where did my money go this month?',
  'Compare this month with last month.',
  'Am I over budget anywhere?',
  'Which subscriptions cost me the most?',
  'What payments are coming up?',
  'How much might I have at the end of this month?',
] as const;

export interface AssistantTurn {
  messages: NewMessage[];
}

export interface AssistantDependencies {
  provider: AiProvider;
  context: ToolContext;
  examples: () => Promise<CategorizedExample[]>;
  now: Date;
}

function planPrompt(caller: Caller, today: string, context: ToolContext): string {
  const tools = AI_TOOL_NAMES.map((name) => `- ${name}: ${TOOL_DESCRIPTIONS[name]}`).join('\n');
  return [
    'You plan how to answer a question in CalmCash, a personal finance app, using only these read-only tools:',
    tools,
    `Today is ${today} in the user's time zone (${caller.timeZone}). Their main currency is ${caller.preferredCurrency}.`,
    'Choose at most 3 tool calls. Fill only fields the tool needs and leave the rest null. Copy category, account, goal, scenario, and merchant names as the user wrote them, and copy any percentage exactly as written.',
    'Questions about the future, what might happen, or "what if" use the estimate tools (getCashFlowForecast, getCategorySpendingForecast, getSavingsGoalProjection, runFinancialScenario); their results are estimates.',
    `Account names: ${context.refs.accounts.map((account) => neutralize(account.name, 40)).join(', ') || 'none'}.`,
    "You cannot change data, move money, read files, settings, passwords, or other users' records, or run SQL — such requests are unsupported.",
    DATA_RULES,
  ].join('\n');
}

function historyFor(messages: readonly MessageRecord[]): string {
  if (messages.length === 0) return '';
  return dataBlock(
    'earlier_conversation',
    messages.map((message) => ({ role: message.role, text: message.content.slice(0, 300) })),
    2_400,
  );
}

function assistantMessage(
  content: string,
  blocks: AssistantBlockDto[],
  outcome: AssistantOutcome,
  narrative: 'assistant' | 'template',
  followUps: string[] = [],
): NewMessage {
  return {
    role: 'assistant',
    content,
    blocks: blocks.slice(0, 8),
    followUps: followUps.slice(0, 3),
    outcome,
    narrative,
  };
}

/** Deduplicated calls of known tools only (a model cannot add a tool by naming one). */
function acceptedCalls(plan: Plan): ToolCallPlan[] {
  const seen = new Set<string>();
  return plan.calls
    .filter((call) => AI_TOOL_NAMES.includes(call.tool))
    .filter((call) => {
      const key = JSON.stringify(call);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, AI_LIMITS.toolCallsPerQuestion);
}

export async function answerQuestion(
  question: string,
  history: readonly MessageRecord[],
  { provider, context, examples, now }: AssistantDependencies,
): Promise<NewMessage> {
  const { caller } = context;
  const today = calendarDateInTimeZone(now, caller.timeZone);
  const draftTurn = async (): Promise<NewMessage> => {
    try {
      const result = await draftFromText(provider, question, {
        caller,
        refs: context.refs,
        examples: await examples(),
        now,
      });
      const content =
        result.kind === 'not_a_transaction'
          ? result.reason
          : 'Here is a draft. Check every field and save it yourself — nothing has been recorded.';
      return assistantMessage(
        content,
        result.kind === 'not_a_transaction' ? [] : [{ kind: 'transaction_draft', result }],
        result.kind === 'clarification' ? 'clarification' : 'answered',
        'template',
      );
    } catch (error: unknown) {
      if (error instanceof AiUnavailableError) {
        return assistantMessage(AI_PROBLEM_MESSAGES[error.problem], [], 'unavailable', 'template');
      }
      throw error;
    }
  };

  // Reported spending goes straight to a draft; everything else is planned by the model.
  if (readsLikeRecord(question)) return draftTurn();

  let plan: Plan;
  try {
    plan = await generateStructured({
      provider,
      schema: planSchema,
      purpose: 'assistant_plan',
      maxOutputTokens: 300,
      messages: [
        { role: 'system', content: planPrompt(caller, today, context) },
        { role: 'user', content: `${historyFor(history)}\nQuestion: ${question}` },
      ],
    });
  } catch (error: unknown) {
    if (error instanceof AiUnavailableError) {
      return assistantMessage(AI_PROBLEM_MESSAGES[error.problem], [], 'unavailable', 'template');
    }
    throw error;
  }

  if (plan.action === 'record_transaction') return draftTurn();

  const calls = acceptedCalls(plan);
  if (plan.action === 'clarify' || (plan.action === 'use_tools' && calls.length === 0)) {
    const asked = sanitizeWording(plan.question ?? '', 300);
    const content =
      plan.action === 'clarify' && asked !== '' && isGrounded(asked, { factTexts: [], question })
        ? asked
        : 'Could you say a little more — for example which period, category, or account you mean?';
    return assistantMessage(content, [], 'clarification', 'template', [
      ...SUGGESTED_QUESTIONS.slice(0, 2),
    ]);
  }
  if (plan.action === 'unsupported') {
    return assistantMessage(
      'I can only answer questions about your own CalmCash records — spending, income, balances, budgets, bills, subscriptions, and goals. I cannot change anything, give investment or tax advice, or look at anything outside your records.',
      [],
      'unsupported',
      'template',
      [...SUGGESTED_QUESTIONS.slice(0, 3)],
    );
  }

  const outcomes: ToolOutcome[] = [];
  for (const call of calls) {
    try {
      outcomes.push(await runTool(call, { ...context, question }));
    } catch (error: unknown) {
      // A bad argument (e.g. an impossible period) is reported, never retried with other data.
      if (error instanceof AppError && error.statusCode < 500) {
        outcomes.push({
          blocks: [
            {
              kind: 'notice',
              tone: 'warning',
              text: 'Part of that question could not be looked up.',
            },
          ],
          links: [],
          facts: [],
          summary: '',
          unresolved: [],
        });
        continue;
      }
      if (error instanceof z.ZodError) continue;
      throw error;
    }
  }
  const blocks = outcomes.flatMap((item) => item.blocks);
  const links: AssistantLinkDto[] = outcomes.flatMap((item) => item.links).slice(0, 6);
  if (links.length > 0) blocks.push({ kind: 'links', links });
  const facts = outcomes.flatMap((item) => item.facts);
  const template =
    outcomes
      .map((item) => item.summary)
      .filter((text) => text !== '')
      .join(' ') || 'Here is what your records show.';
  const narration = await narrate(provider, {
    question,
    facts,
    template,
    purpose: 'assistant_answer',
  });
  return assistantMessage(
    narration.text,
    blocks,
    'answered',
    narration.source,
    narration.followUps,
  );
}

/** A title from the first question (plain, bounded). */
export function titleFrom(question: string): string {
  const text = neutralize(question, 80).replace(/\s+/g, ' ');
  return text === '' ? 'New conversation' : text;
}
