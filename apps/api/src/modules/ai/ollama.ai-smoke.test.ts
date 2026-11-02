import type { AccountDto, CategoryDto } from '@calmcash/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { aiEnvFields, checkAiEnv, toAiConfig } from '../../config/ai-env';
import { draftFromText } from './drafts';
import { isGrounded } from './grounding';
import { narrate } from './narration';
import { createOllamaProvider } from './provider/ollama-provider';
import { interpretSearch } from './search';

// Smoke test against the real local model (`pnpm test:ai-smoke`, see the development guide).
// Everything sent is made up below. Models differ, so this checks the guarantees CalmCash adds
// around any model — validated shapes, no invented amounts, grounded wording — not exact answers.

const env = z.object(aiEnvFields).superRefine(checkAiEnv).parse(process.env);
const config = toAiConfig(env);
const provider = createOllamaProvider({ config, logger: pino({ level: 'silent' }) });

/** Timing and raw outcomes for the person running the smoke test (synthetic data only). */
function report(line: string): void {
  process.stdout.write(`${line}
`);
}

const USER = '00000000-0000-4000-8000-000000000001';
const STAMP = '2026-01-01T00:00:00.000Z';
const CALLER = { userId: USER, timeZone: 'Asia/Kolkata', preferredCurrency: 'INR' } as const;
const NOW = new Date('2026-10-29T04:30:00.000Z');

function account(id: string, name: string): AccountDto {
  return {
    id,
    userId: USER,
    name,
    type: 'bank',
    classification: 'asset',
    currency: 'INR',
    openingBalanceMinor: '0',
    openingBalanceDate: '2026-01-01',
    status: 'active',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function category(id: string, name: string, kind: CategoryDto['kind']): CategoryDto {
  return { id, userId: USER, name, kind, status: 'active', createdAt: STAMP, updatedAt: STAMP };
}

const REFS = {
  accounts: [
    account('00000000-0000-4000-8000-0000000000a1', 'HDFC'),
    account('00000000-0000-4000-8000-0000000000a2', 'Cash'),
  ],
  categories: [
    category('00000000-0000-4000-8000-0000000000c1', 'Food', 'expense'),
    category('00000000-0000-4000-8000-0000000000c2', 'Groceries', 'expense'),
    category('00000000-0000-4000-8000-0000000000c3', 'Salary', 'income'),
  ],
};

describe(`local model ${config.model} at ${config.baseUrl}`, () => {
  it('is reachable with the configured model pulled', async () => {
    const status = await provider.status({ refresh: true });

    expect(
      status,
      `Start Ollama and run "ollama pull ${config.model}" before this smoke test.`,
    ).toMatchObject({ reachable: true, modelInstalled: true });
  });

  it('drafts an expense without inventing the amount', async () => {
    const started = Date.now();
    const result = await draftFromText(
      provider,
      'I spent 450 rupees on dinner at Swiggy yesterday from HDFC',
      { caller: CALLER, refs: REFS, examples: [], now: NOW },
    );
    report(`draft: ${result.kind} in ${(Date.now() - started).toString()} ms`);

    expect(result.kind).not.toBe('not_a_transaction');
    if (result.kind === 'not_a_transaction') return;
    expect(result.draft.type).toBe('expense');
    expect(result.draft.date).toBe('2026-10-28');
    expect([undefined, '450.00']).toContain(result.draft.amount);
  });

  it('turns a search into filters that only use the person’s words', async () => {
    const query = 'food expenses above 2000 last month';
    const result = await interpretSearch(provider, CALLER, query, REFS, NOW);
    report(`search: ${JSON.stringify(result)}`);

    if (result.kind === 'filters') {
      expect([undefined, '2000']).toContain(result.filters.minAmount);
      expect(result.filters.maxAmount).toBeUndefined();
      expect(result.chips.length).toBeGreaterThan(0);
    }
  });

  it('words an answer from facts without new numbers, or falls back to the template', async () => {
    const facts = [
      'Cash flow (1 Oct 2026 – 29 Oct 2026), INR',
      '- Money in: ₹85,000.00: 1 income entries',
      '- Money out: ₹41,250.00: 37 expenses',
      '- Net cash flow: ₹43,750.00',
    ];
    const question = 'How am I doing this month?';
    const narration = await narrate(provider, {
      question,
      facts,
      template: 'Here is your cash flow.',
      purpose: 'smoke',
    });
    report(`narration (${narration.source}): ${narration.text}`);

    expect(isGrounded(narration.text, { factTexts: facts, question })).toBe(true);
  });
});
