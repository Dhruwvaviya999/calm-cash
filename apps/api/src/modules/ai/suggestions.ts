import {
  AI_LIMITS,
  type CategoryDto,
  type CategorySuggestionDto,
  type CategorySuggestionsDto,
  type MerchantSuggestionDto,
  type MerchantSuggestionsDto,
  type TransactionListItemDto,
} from '@calmcash/shared';
import { z } from 'zod';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { descriptionKey, payeeKey } from '../insights/merchant-key';
import type { TransactionsService } from '../transactions/transactions.service';
import type { AiRepository, CategorizedExample } from './ai.repository';
import { isGrounded, sanitizeWording } from './grounding';
import { DATA_RULES, dataBlock, neutralize } from './prompting';
import { AiUnavailableError, type AiProvider } from './provider/ai-provider';
import { generateStructured } from './provider/structured';

// Category and merchant suggestions. Nothing is changed here: suggestions are shown for review,
// and an accepted one is saved by the web app through the ordinary transaction update (with all
// of its locks and rules). The person's own history is used first (no AI needed); the model only
// picks among the user's own categories by number, and every pick is re-checked: the category
// must exist, be active, match the transaction type, and not be one they already rejected.

export interface SuggestionDependencies {
  repository: AiRepository;
  transactions: Pick<TransactionsService, 'get' | 'list'>;
  /** The provider when AI may be used for this request, otherwise `undefined`. */
  provider: AiProvider | undefined;
}

const HISTORY_EXAMPLES = 2_000;

function historyIndex(examples: readonly CategorizedExample[]): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const example of examples) {
    const key = `${example.type}:${payeeKey(example.merchant, example.description)}`;
    const counts = index.get(key) ?? new Map<string, number>();
    counts.set(example.categoryId, (counts.get(example.categoryId) ?? 0) + 1);
    index.set(key, counts);
  }
  return index;
}

const pickSchema = z.object({
  picks: z
    .array(
      z.object({
        ref: z.string().max(10),
        category: z
          .number()
          .int()
          .min(0)
          .max(500)
          .nullish()
          .describe('Number of the category, or null if unsure.'),
        reason: z.string().max(160).nullish(),
      }),
    )
    .max(AI_LIMITS.categorizeBatch),
});

export async function suggestCategories(
  caller: Caller,
  transactionIds: readonly string[],
  categories: readonly CategoryDto[],
  { repository, transactions, provider }: SuggestionDependencies,
): Promise<CategorySuggestionsDto> {
  const rejected = new Set(
    (await repository.dismissals(caller.userId, 'category')).map(
      (row) => `${row.subjectKey}:${row.value}`,
    ),
  );
  const index = historyIndex(await repository.categorizedExamples(caller.userId, HISTORY_EXAMPLES));
  const usable = (type: 'income' | 'expense', transactionId: string): CategoryDto[] =>
    categories.filter(
      (category) =>
        category.kind === type &&
        category.status === 'active' &&
        !rejected.has(`${transactionId}:${category.id}`),
    );

  const items: CategorySuggestionDto[] = [];
  const forModel: { item: TransactionListItemDto; type: 'income' | 'expense' }[] = [];
  for (const id of [...new Set(transactionIds)]) {
    let item: TransactionListItemDto;
    try {
      item = await transactions.get(caller, id);
    } catch (error: unknown) {
      if (error instanceof AppError && error.statusCode === 404) {
        items.push({ transactionId: id, reason: 'This transaction was not found.' });
        continue;
      }
      throw error;
    }
    const { transaction } = item;
    if (transaction.type !== 'income' && transaction.type !== 'expense') {
      items.push({ transactionId: id, reason: 'Transfers and adjustments have no category.' });
      continue;
    }
    if (transaction.status !== 'active') {
      items.push({ transactionId: id, reason: 'Voided transactions are left as they are.' });
      continue;
    }
    if (transaction.categoryId !== undefined) {
      items.push({
        transactionId: id,
        reason: 'It already has a category you chose; it is left unchanged.',
      });
      continue;
    }
    const counts = index.get(
      `${transaction.type}:${payeeKey(transaction.merchant, transaction.description)}`,
    );
    const allowed = new Set(usable(transaction.type, id).map((category) => category.id));
    const best = [...(counts?.entries() ?? [])]
      .filter(([categoryId]) => allowed.has(categoryId))
      .sort((a, b) => b[1] - a[1])[0];
    if (best !== undefined) {
      const name = categories.find((category) => category.id === best[0])?.name ?? 'this category';
      items.push({
        transactionId: id,
        categoryId: best[0],
        basis: 'your_history',
        reason: `You chose ${name} for ${best[1].toString()} earlier ${best[1] === 1 ? 'payment' : 'payments'} like this.`,
      });
    } else {
      forModel.push({ item, type: transaction.type });
    }
  }

  let assistantUsed = false;
  if (forModel.length > 0 && provider !== undefined) {
    const numbered = categories.filter((category) => category.status === 'active');
    try {
      const result = await generateStructured({
        provider,
        schema: pickSchema,
        purpose: 'category_suggestions',
        maxOutputTokens: 60 * forModel.length,
        messages: [
          {
            role: 'system',
            content: `Pick the best category number for each transaction from the list, or null when unsure. Income transactions take income categories, expenses take expense categories. Give a short reason based only on the transaction text. ${DATA_RULES}`,
          },
          {
            role: 'user',
            content: [
              dataBlock(
                'categories',
                numbered.map(
                  (category, position) =>
                    `${position.toString()}: ${category.name} (${category.kind})`,
                ),
                3_000,
              ),
              dataBlock(
                'transactions',
                forModel.map(({ item, type }, position) => ({
                  ref: `t${position.toString()}`,
                  type,
                  description: item.transaction.description,
                  merchant:
                    item.transaction.type === 'expense' || item.transaction.type === 'income'
                      ? item.transaction.merchant
                      : undefined,
                })),
                3_000,
              ),
            ].join('\n'),
          },
        ],
      });
      assistantUsed = true;
      for (const [position, { item, type }] of forModel.entries()) {
        const pick = result.picks.find((entry) => entry.ref === `t${position.toString()}`);
        const category =
          pick?.category === undefined || pick.category === null
            ? undefined
            : numbered[pick.category];
        const valid =
          category !== undefined &&
          usable(type, item.transaction.id).some((entry) => entry.id === category.id);
        const reasonText = sanitizeWording(neutralize(pick?.reason ?? '', 160), 160);
        const reason =
          reasonText !== '' &&
          isGrounded(reasonText, { factTexts: [item.transaction.description], question: '' })
            ? reasonText
            : 'Suggested by the assistant from the description.';
        items.push(
          valid
            ? {
                transactionId: item.transaction.id,
                categoryId: category.id,
                basis: 'assistant',
                reason,
              }
            : {
                transactionId: item.transaction.id,
                reason: 'No confident suggestion; choose a category yourself.',
              },
        );
      }
    } catch (error: unknown) {
      if (!(error instanceof AiUnavailableError)) throw error;
      for (const { item } of forModel) {
        items.push({
          transactionId: item.transaction.id,
          reason: 'The assistant is unavailable; choose a category yourself.',
        });
      }
    }
  } else {
    for (const { item } of forModel) {
      items.push({
        transactionId: item.transaction.id,
        reason: 'No earlier payment like this; choose a category yourself.',
      });
    }
  }
  const order = new Map(transactionIds.map((id, position) => [id, position]));
  items.sort((a, b) => (order.get(a.transactionId) ?? 0) - (order.get(b.transactionId) ?? 0));
  return { items, assistantUsed };
}

// --- Merchants -----------------------------------------------------------------------------------

/** Well-known merchants recognised from distinctive tokens only (never from vague text). */
const KNOWN_MERCHANTS: readonly [RegExp, string][] = [
  [/\b(amzn|amazon)\b/i, 'Amazon'],
  [/\bswiggy\b/i, 'Swiggy'],
  [/\bzomato\b/i, 'Zomato'],
  [/\buber\b/i, 'Uber'],
  [/\bnetflix\b/i, 'Netflix'],
  [/\bspotify\b/i, 'Spotify'],
  [/\bflipkart\b/i, 'Flipkart'],
  [/\bmyntra\b/i, 'Myntra'],
  [/\bbigbasket\b/i, 'BigBasket'],
  [/\bblinkit\b/i, 'Blinkit'],
  [/\bzepto\b/i, 'Zepto'],
  [/\birctc\b/i, 'IRCTC'],
  [/\bairtel\b/i, 'Airtel'],
  [/\bjio\b/i, 'Jio'],
];

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * A readable merchant from a description by fixed rules: a known merchant token, or the payee
 * name of a UPI line (`UPI/RAHUL123/…` → "Rahul"). A name is a label for the payee, not a claim
 * about who they are.
 */
export function ruleBasedMerchant(description: string): string | undefined {
  const known = KNOWN_MERCHANTS.find(([pattern]) => pattern.test(description));
  if (known !== undefined) return known[1];
  const upi = /^upi[/ -]+([^/@-]+)(?:@[^/-]+)?[/-]/i.exec(description.trim());
  const name = upi?.[1]?.replace(/[^a-z\s]/gi, ' ').trim();
  if (name !== undefined && /^[a-z]{3,}(\s[a-z]{2,})?$/i.test(name)) {
    return name.split(/\s+/).map(titleCase).join(' ');
  }
  return undefined;
}

/** Every word of the suggestion (3+ letters) appears in the description. */
function supportedByDescription(suggestion: string, description: string): boolean {
  const letters = description.toLowerCase().replace(/[^a-z]/g, '');
  const words = suggestion.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return words.length > 0 && words.every((word) => letters.includes(word));
}

const merchantSchema = z.object({
  items: z
    .array(z.object({ ref: z.string().max(10), merchant: z.string().max(80).nullish() }))
    .max(AI_LIMITS.merchantSuggestions),
});

export async function suggestMerchants(
  caller: Caller,
  { repository, transactions, provider }: SuggestionDependencies,
): Promise<MerchantSuggestionsDto> {
  const [page, rules, dismissed] = await Promise.all([
    transactions.list(caller, { status: 'active', sort: 'newest', page: 1, pageSize: 100 }),
    repository.merchantRules(caller.userId),
    repository.dismissals(caller.userId, 'merchant'),
  ]);
  const skip = new Set(dismissed.map((row) => row.subjectKey));
  const byPattern = new Map(rules.map((rule) => [rule.patternKey, rule.merchant]));
  const items: MerchantSuggestionDto[] = [];
  const forModel: { id: string; description: string; patternKey: string }[] = [];
  for (const { transaction } of page.items) {
    if (items.length + forModel.length >= AI_LIMITS.merchantSuggestions) break;
    if (
      (transaction.type !== 'expense' && transaction.type !== 'income') ||
      transaction.merchant !== undefined
    )
      continue;
    if (skip.has(transaction.id)) continue;
    const patternKey = descriptionKey(transaction.description);
    if (patternKey.length < 3) continue;
    const ruled = byPattern.get(patternKey);
    const rule = ruled === undefined ? ruleBasedMerchant(transaction.description) : undefined;
    if (ruled !== undefined || rule !== undefined) {
      items.push({
        transactionId: transaction.id,
        description: transaction.description,
        suggestedMerchant: ruled ?? rule ?? '',
        basis: ruled !== undefined ? 'your_rule' : 'pattern',
        patternKey,
      });
    } else {
      forModel.push({ id: transaction.id, description: transaction.description, patternKey });
    }
  }

  let assistantUsed = false;
  if (forModel.length > 0 && provider !== undefined) {
    try {
      const result = await generateStructured({
        provider,
        schema: merchantSchema,
        purpose: 'merchant_suggestions',
        maxOutputTokens: 30 * forModel.length,
        messages: [
          {
            role: 'system',
            content: `For each bank description, give a short readable merchant or payee name using only words found in it, or null when it is not clear. Never guess a person's or company's identity beyond the text. ${DATA_RULES}`,
          },
          {
            role: 'user',
            content: dataBlock(
              'descriptions',
              forModel.map((entry, position) => ({
                ref: `d${position.toString()}`,
                description: entry.description,
              })),
              4_000,
            ),
          },
        ],
      });
      assistantUsed = true;
      for (const [position, entry] of forModel.entries()) {
        const merchant = result.items
          .find((item) => item.ref === `d${position.toString()}`)
          ?.merchant?.trim();
        if (
          merchant !== undefined &&
          merchant.length >= 2 &&
          supportedByDescription(merchant, entry.description)
        ) {
          items.push({
            transactionId: entry.id,
            description: entry.description,
            suggestedMerchant: neutralize(merchant, 120),
            basis: 'assistant',
            patternKey: entry.patternKey,
          });
        }
      }
    } catch (error: unknown) {
      if (!(error instanceof AiUnavailableError)) throw error;
    }
  }
  return { items, assistantUsed };
}

/** A suggestion for a transaction still being entered (nothing is stored). */
export async function suggestCategoryForEntry(
  caller: Caller,
  entry: { type: 'income' | 'expense'; description: string; merchant?: string | undefined },
  categories: readonly CategoryDto[],
  { repository, provider }: Pick<SuggestionDependencies, 'repository' | 'provider'>,
): Promise<Omit<CategorySuggestionDto, 'transactionId'>> {
  const usable = categories.filter(
    (category) => category.kind === entry.type && category.status === 'active',
  );
  const index = historyIndex(await repository.categorizedExamples(caller.userId, HISTORY_EXAMPLES));
  const counts = index.get(`${entry.type}:${payeeKey(entry.merchant ?? null, entry.description)}`);
  const best = [...(counts?.entries() ?? [])]
    .filter(([categoryId]) => usable.some((category) => category.id === categoryId))
    .sort((a, b) => b[1] - a[1])[0];
  if (best !== undefined) {
    const name = usable.find((category) => category.id === best[0])?.name ?? 'this category';
    return {
      categoryId: best[0],
      basis: 'your_history',
      reason: `You chose ${name} for ${best[1].toString()} earlier ${best[1] === 1 ? 'payment' : 'payments'} like this.`,
    };
  }
  if (provider === undefined) return { reason: 'No earlier payment like this.' };
  try {
    const result = await generateStructured({
      provider,
      schema: pickSchema,
      purpose: 'category_suggestion_entry',
      maxOutputTokens: 80,
      messages: [
        {
          role: 'system',
          content: `Pick the best category number for the transaction from the list, or null when unsure, with a short reason based only on its text. ${DATA_RULES}`,
        },
        {
          role: 'user',
          content: [
            dataBlock(
              'categories',
              usable.map((category, position) => `${position.toString()}: ${category.name}`),
              3_000,
            ),
            dataBlock(
              'transactions',
              [
                {
                  ref: 't0',
                  type: entry.type,
                  description: entry.description,
                  merchant: entry.merchant,
                },
              ],
              800,
            ),
          ].join('\n'),
        },
      ],
    });
    const pick = result.picks.find((item) => item.ref === 't0');
    const category =
      pick?.category === undefined || pick.category === null ? undefined : usable[pick.category];
    if (category === undefined) return { reason: 'No confident suggestion.' };
    const reasonText = sanitizeWording(neutralize(pick?.reason ?? '', 160), 160);
    return {
      categoryId: category.id,
      basis: 'assistant',
      reason:
        reasonText !== '' &&
        isGrounded(reasonText, { factTexts: [entry.description], question: '' })
          ? reasonText
          : 'Suggested by the assistant from the description.',
    };
  } catch (error: unknown) {
    if (error instanceof AiUnavailableError) return { reason: 'The assistant is unavailable.' };
    throw error;
  }
}
