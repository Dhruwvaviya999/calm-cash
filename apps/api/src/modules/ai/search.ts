import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  CURRENCY_CODES,
  presetRange,
  transactionLinkFiltersSchema,
  type DashboardPreset,
  type FilterChipDto,
  type SearchInterpretationDto,
  type TransactionLinkFilters,
} from '@calmcash/shared';
import { z } from 'zod';

import type { Caller } from '../../lib/auth-boundary';
import { formatRange } from '../../lib/text-format';
import { readMonthRange } from './date-expressions';
import { amountInText } from './drafts';
import { DATA_RULES, neutralize } from './prompting';
import type { AiProvider } from './provider/ai-provider';
import { generateStructured } from './provider/structured';
import { matchByName, type UserReferences } from './tools';

// Natural-language transaction search. Fixed rules read what can be read from the person's own
// words — the type, period, order, amount limits, currency, and category or account names written
// in full. The model only helps with the rest (a partly written category or account name, a
// merchant to look for, whether this is a search at all), and each of its answers is checked
// against the question and the person's own names. The result is shown as editable chips and
// runs through the normal transaction list, with its ownership rules — it can only ever narrow
// the person's own data.

const interpretationSchema = z.object({
  understood: z.boolean().describe("false if this is not a search of the user's transactions."),
  category: z.string().max(60).nullish().describe('A spending or income category named.'),
  account: z.string().max(60).nullish().describe('An account named.'),
  text: z
    .string()
    .max(60)
    .nullish()
    .describe('A merchant, person, or word to look for, in at most three words.'),
  minAmount: z.string().max(20).nullish().describe('Lower amount limit as written.'),
  maxAmount: z.string().max(20).nullish().describe('Upper amount limit as written.'),
});

type TransactionType = NonNullable<TransactionLinkFilters['type']>;

const TYPE_WORDS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};

/** A type filter is only used when the question says it. */
const TYPE_PATTERNS: Readonly<Record<TransactionType, RegExp>> = {
  income: /\b(income|incomes|earned|earnings|received|salary|salaries|refunds?|credited)\b/i,
  expense: /\b(expenses?|spent|spending|spend|paid|payments?|purchases?|bought|bills?)\b/i,
  transfer: /\b(transfers?|transferred|moved)\b/i,
};

const CURRENCY_SIGN = String.raw`(?:rs\.?|inr|usd|eur|gbp|₹|\$|€|£)?`;
const LIMIT_PATTERNS = {
  minAmount: new RegExp(
    String.raw`\b(?:above|over|more than|greater than|at least|min(?:imum)?(?: of)?)\s*${CURRENCY_SIGN}\s*(\d[\d,]*(?:\.\d+)?)`,
    'i',
  ),
  maxAmount: new RegExp(
    String.raw`\b(?:below|under|less than|at most|up to|max(?:imum)?(?: of)?)\s*${CURRENCY_SIGN}\s*(\d[\d,]*(?:\.\d+)?)`,
    'i',
  ),
} as const;

const PERIOD_PATTERNS: readonly [RegExp, DashboardPreset | 'today' | 'this-week'][] = [
  [/\btoday\b/i, 'today'],
  [/\b(this|past|last) week\b|\blast 7 days\b/i, 'this-week'],
  [/\b(last|past) (3|three) months\b/i, 'last-3-months'],
  [/\b(last|past) (6|six) months\b/i, 'last-6-months'],
  [/\bthis year\b/i, 'this-year'],
];

function typeInWords(query: string): TransactionType | undefined {
  const found = (['income', 'expense', 'transfer'] as const).filter((type) =>
    TYPE_PATTERNS[type].test(query),
  );
  return found.length === 1 ? found[0] : undefined;
}

function periodInWords(query: string, today: string): { from: string; to: string } | undefined {
  const month = readMonthRange(query, today);
  if (month !== undefined) return month;
  const preset = PERIOD_PATTERNS.find(([pattern]) => pattern.test(query))?.[1];
  if (preset === undefined) return undefined;
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'this-week') return { from: addDaysToIsoDate(today, -6), to: today };
  return presetRange(preset, today);
}

function plainWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

/** The one name of the person's written in full in the question (the longest when nested). */
function nameInWords<T extends { name: string }>(
  items: readonly T[],
  query: string,
): T | undefined {
  const words = plainWords(query);
  const found = items.filter((item) => {
    const name = plainWords(item.name);
    return name.trim().length >= 3 && words.includes(name);
  });
  const outermost = found.filter(
    (item) =>
      !found.some(
        (other) => other !== item && plainWords(other.name).includes(plainWords(item.name)),
      ),
  );
  return outermost.length === 1 ? outermost[0] : undefined;
}

/** Search text the model picked: short, no digits, and written in the question. */
function searchText(text: string | null | undefined, query: string): string | undefined {
  const trimmed = text?.trim();
  if (trimmed === undefined || trimmed.length < 2 || trimmed.length > 40) return undefined;
  if (/\d/.test(trimmed) || trimmed.split(/\s+/).length > 3) return undefined;
  return plainWords(query).includes(plainWords(trimmed)) ? neutralize(trimmed, 100) : undefined;
}

export async function interpretSearch(
  provider: AiProvider,
  caller: Caller,
  query: string,
  refs: UserReferences,
  now: Date,
): Promise<SearchInterpretationDto> {
  const today = calendarDateInTimeZone(now, caller.timeZone);
  const parsed = await generateStructured({
    provider,
    schema: interpretationSchema,
    purpose: 'search_interpretation',
    maxOutputTokens: 160,
    messages: [
      {
        role: 'system',
        content: `Turn a request to find the user's own transactions into search fields. Use words from the request; leave fields null when not mentioned. ${DATA_RULES}`,
      },
      { role: 'user', content: `<data name="request">${neutralize(query, 200)}</data>` },
    ],
  });
  if (!parsed.understood) {
    return {
      kind: 'not_understood',
      query,
      reason:
        'That does not look like a search of your transactions. Try “Expenses above 2000 last month”.',
    };
  }

  const filters: TransactionLinkFilters = {};
  const chips: FilterChipDto[] = [];
  const unresolved: string[] = [];
  const type = typeInWords(query);
  if (type !== undefined) {
    filters.type = type;
    chips.push({ key: 'type', label: TYPE_WORDS[type] });
  }
  const resolve = <T extends { id: string; name: string }>(
    items: readonly T[],
    named: string | null | undefined,
  ): T | undefined => {
    const written = nameInWords(items, query);
    if (written !== undefined || named === undefined || named === null) return written;
    const matched = matchByName(items, named);
    if (matched === undefined) unresolved.push(neutralize(named, 60));
    return matched;
  };
  const category = resolve(refs.categories, parsed.category);
  if (category !== undefined) {
    filters.categoryId = category.id;
    chips.push({ key: 'categoryId', label: `Category: ${category.name}` });
  }
  const account = resolve(refs.accounts, parsed.account);
  if (account !== undefined) {
    filters.accountId = account.id;
    chips.push({ key: 'accountId', label: `Account: ${account.name}` });
  }
  const text = searchText(parsed.text, query);
  const namedAlready = [category?.name, account?.name].some(
    (name) => name !== undefined && text !== undefined && plainWords(name) === plainWords(text),
  );
  if (text !== undefined && !namedAlready) {
    filters.q = text;
    chips.push({ key: 'q', label: `Matching “${text}”` });
  }
  for (const field of ['minAmount', 'maxAmount'] as const) {
    const written = LIMIT_PATTERNS[field].exec(query)?.[1]?.replace(/,/g, '');
    const value = parsed[field];
    const amount =
      written ?? (value === undefined || value === null ? undefined : amountInText(value, query));
    if (amount !== undefined) {
      filters[field] = amount;
      chips.push({
        key: field,
        label: `${field === 'minAmount' ? 'At least' : 'At most'} ${amount}`,
      });
    }
  }
  const currencyMentioned = CURRENCY_CODES.find((code) =>
    new RegExp(`\\b${code}\\b`, 'i').test(query),
  );
  if (currencyMentioned !== undefined) {
    filters.currency = currencyMentioned;
    chips.push({ key: 'currency', label: currencyMentioned });
  }
  const range = periodInWords(query, today);
  if (range !== undefined) {
    filters.from = range.from;
    filters.to = range.to;
    chips.push({ key: 'from', label: formatRange(range.from, range.to) });
  }
  const sort = /\b(largest|biggest|highest|most expensive)\b/i.test(query)
    ? 'largest'
    : /\b(smallest|lowest|cheapest)\b/i.test(query)
      ? 'smallest'
      : undefined;
  if (sort !== undefined) {
    filters.sort = sort;
    chips.push({ key: 'sort', label: sort === 'largest' ? 'Largest first' : 'Smallest first' });
  }

  const validated = transactionLinkFiltersSchema.safeParse(filters);
  if (!validated.success || chips.length === 0) {
    return {
      kind: 'not_understood',
      query,
      reason:
        unresolved.length > 0
          ? `None of your categories or accounts is called ${unresolved.map((name) => `“${name}”`).join(' or ')}.`
          : 'No search filters could be read from that. Try naming a category, merchant, amount, or period.',
    };
  }
  return {
    kind: 'filters',
    query,
    filters: validated.data,
    chips,
    unresolved: unresolved.slice(0, 5),
  };
}
