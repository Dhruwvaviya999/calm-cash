import { z } from 'zod';

import { isGrounded, sanitizeWording } from './grounding';
import { DATA_RULES, dataBlock } from './prompting';
import { AiUnavailableError, type AiProvider } from './provider/ai-provider';
import { generateStructured } from './provider/structured';

// Wording around deterministic facts. The model sees only the facts' text and the question, and
// is told to copy figures, not compute them. Its answer is sanitised (no HTML or links) and must
// pass the grounding check; otherwise — or when AI is unavailable — the fixed template is used.

const narrativeSchema = z.object({
  answer: z.string().min(1).max(1_200).describe('2 to 4 short sentences answering the question.'),
  followUps: z
    .array(z.string().min(3).max(120))
    .max(3)
    .describe('Up to 3 short questions the user could ask next about their own money.'),
});

export interface Narration {
  text: string;
  followUps: string[];
  source: 'assistant' | 'template';
}

export interface NarrateRequest {
  question: string;
  facts: readonly string[];
  template: string;
  purpose: string;
  signal?: AbortSignal | undefined;
}

export const NARRATION_RULES = [
  'You explain facts from CalmCash, a personal finance app, to its user.',
  'Answer only from the facts given. Copy amounts, dates, and percentages exactly as written; never calculate, estimate, or round a new number.',
  'If the facts do not answer the question, say what is missing.',
  'Mention the period and currency the figures cover.',
  'A change in recorded amounts does not tell why it changed: never invent reasons.',
  'An unusual payment is not evidence of fraud.',
  'No investment, tax, or legal advice. Plain text, no links, no HTML.',
].join(' ');

export async function narrate(
  provider: AiProvider | undefined,
  { question, facts, template, purpose, signal }: NarrateRequest,
): Promise<Narration> {
  const fallback: Narration = { text: template, followUps: [], source: 'template' };
  if (provider === undefined || facts.length === 0) return fallback;
  try {
    const result = await generateStructured({
      provider,
      schema: narrativeSchema,
      purpose,
      maxOutputTokens: 320,
      signal,
      messages: [
        { role: 'system', content: `${NARRATION_RULES} ${DATA_RULES}` },
        { role: 'user', content: `Question: ${question}\n${dataBlock('facts', facts, 6_000)}` },
      ],
    });
    const text = sanitizeWording(result.answer, 1_200);
    const grounding = { factTexts: facts, question };
    if (text === '' || !isGrounded(text, grounding)) return fallback;
    return {
      text,
      followUps: result.followUps
        .map((item) => sanitizeWording(item, 120))
        .filter((item) => item !== '' && isGrounded(item, grounding))
        .slice(0, 3),
      source: 'assistant',
    };
  } catch (error: unknown) {
    if (error instanceof AiUnavailableError) return fallback;
    throw error;
  }
}
