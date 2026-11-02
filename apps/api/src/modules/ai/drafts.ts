import {
  calendarDateInTimeZone,
  CURRENCIES,
  describeDecimalAmountError,
  formatDecimalAmount,
  parseDecimalAmount,
  transactionDraftResultDtoSchema,
  type AccountDto,
  type CategoryDto,
  type CurrencyCode,
  type DraftNoteDto,
  type PaymentMethod,
  type TransactionDraftDto,
  type TransactionDraftResultDto,
} from '@calmcash/shared';
import { z } from 'zod';

import type { Caller } from '../../lib/auth-boundary';
import { payeeKey } from '../insights/merchant-key';
import type { CategorizedExample } from './ai.repository';
import { readDate, readTime } from './date-expressions';
import { DATA_RULES, neutralize } from './prompting';
import type { AiProvider } from './provider/ai-provider';
import { generateStructured } from './provider/structured';
import { matchByName, type UserReferences } from './tools';

// Natural-language transaction drafts. The model only *extracts* phrases from the person's text.
// Everything that matters is decided here from their own words and records: the type from verbs,
// the amount with `parseDecimalAmount` (only digits that appear in the text), the date from
// date-expressions.ts in their time zone, accounts and categories by name among their own active
// ones, and the payment method from keywords. Anything unclear becomes a question. A draft is
// never saved by the API: the entry form shows it, and only the person's Save records it.

const extractionSchema = z.object({
  kind: z
    .enum(['record', 'future', 'not_transaction'])
    .describe(
      'record: money already spent, received, or moved. future: planned or intended. not_transaction: anything else.',
    ),
  type: z
    .enum(['income', 'expense', 'transfer'])
    .nullish()
    .describe(
      'expense: spent, paid, bought. income: received, got, earned. transfer: moved between own accounts.',
    ),
  amount: z
    .string()
    .max(30)
    .nullish()
    .describe('The amount as written in the text, digits only, e.g. 450 or 1200.50.'),
  description: z.string().max(120).nullish().describe('What it was for, in a few words.'),
  counterparty: z
    .string()
    .max(80)
    .nullish()
    .describe('The shop, person, or payer named in the text.'),
  account: z.string().max(60).nullish().describe('Account named as the source, if any.'),
  toAccount: z.string().max(60).nullish().describe('Transfers only: account the money went to.'),
  category: z
    .string()
    .max(60)
    .nullish()
    .describe('Kind of spending or income, e.g. groceries, salary.'),
});

const FUTURE_INTENT =
  /\b(will|going to|gonna|plan(?:ning)? to|intend to|have to pay|need to pay|should pay|must pay|due on|remind me)\b/i;
const VERBS = {
  expense: /\b(spent|spend|paid|pay|bought|purchased|ordered|charged)\b/i,
  income: /\b(received|receive|got|earned|credited|salary|refund(?:ed)?)\b/i,
  transfer: /\b(transferred|transfer|moved|move)\b/i,
} as const;

/** Past-tense money verbs: the sentence reports something that happened, whatever a model says. */
const PAST_MONEY_VERBS =
  /\b(spent|paid|bought|purchased|ordered|charged|received|got|earned|credited|transferred|moved)\b/i;

const QUESTION_START =
  /^(how|what|when|where|which|who|why|did|do|does|am|is|are|was|were|can|could|should|show|list|tell|find|compare)\b/i;

/**
 * A sentence that reports money already moved ("Spent 450 on dinner yesterday"): a past-tense
 * money verb and a number, and not a question. Such sentences go straight to a draft — a small
 * model sometimes plans a lookup for them instead.
 */
export function readsLikeRecord(text: string): boolean {
  const trimmed = text.trim();
  return (
    PAST_MONEY_VERBS.test(trimmed) &&
    /\d/.test(trimmed) &&
    !trimmed.endsWith('?') &&
    !QUESTION_START.test(trimmed) &&
    !FUTURE_INTENT.test(trimmed)
  );
}

const PAYMENT_KEYWORDS: readonly [RegExp, PaymentMethod][] = [
  [/\bupi\b|\bgpay\b|\bphone ?pe\b|\bpaytm\b/i, 'upi'],
  [/\bcredit card\b/i, 'credit_card'],
  [/\bdebit card\b/i, 'debit_card'],
  [/\bnet ?banking\b/i, 'net_banking'],
  [/\bcheque\b/i, 'cheque'],
  [/\bcash\b/i, 'cash'],
  [/\bbank transfer\b|\bneft\b|\bimps\b|\brtgs\b/i, 'bank_transfer'],
];

const CURRENCY_WORDS: readonly [RegExp, CurrencyCode][] = [
  [/₹|\brs\.?\b|\brupees?\b|\binr\b/i, 'INR'],
  [/\$|\bdollars?\b|\busd\b/i, 'USD'],
  [/€|\beuros?\b|\beur\b/i, 'EUR'],
  [/£|\bpounds?\b|\bgbp\b/i, 'GBP'],
];

/** Digits of `amount` appear in `text` (separators ignored), so the model did not invent it. */
export function amountInText(amount: string, text: string): string | undefined {
  const plain = amount.replace(/[^\d.]/g, '').replace(/\.0+$/, '');
  if (!/^\d+(\.\d+)?$/.test(plain)) return undefined;
  const numbers = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) =>
    match[0].replace(/,/g, '').replace(/\.0+$/, ''),
  );
  return numbers.includes(plain) ? plain : undefined;
}

/** The only amount in the text, when there is exactly one (dates and times excluded). */
function soleAmount(text: string): string | undefined {
  const stripped = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\s*(am|pm)\b/gi, ' ')
    .replace(
      /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/gi,
      ' ',
    )
    .replace(/\b\d{1,3}\s+(days?|weeks?)\s+ago\b/gi, ' ');
  const numbers = [...stripped.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) =>
    match[0].replace(/,/g, ''),
  );
  return numbers.length === 1 ? numbers[0] : undefined;
}

/** Words of a phrase the model returned all appear in the person's text. */
function wordsInText(phrase: string | null | undefined, text: string): string | undefined {
  if (phrase === undefined || phrase === null) return undefined;
  const words = phrase.toLowerCase().match(/[\p{L}\p{N}']{2,}/gu) ?? [];
  const lower = text.toLowerCase();
  return words.length > 0 && words.every((word) => lower.includes(word))
    ? neutralize(phrase, 120)
    : undefined;
}

/**
 * "… at Swiggy …" → "Swiggy": a capitalised name right after "at", when the model named no payee.
 * Account names are never taken as the payee.
 */
function payeeAfterAt(text: string, accounts: readonly AccountDto[]): string | undefined {
  const name = /\bat\s+((?:[A-Z][\w&'.-]*)(?:\s+[A-Z][\w&'.-]*){0,3})/.exec(text)?.[1];
  if (name === undefined) return undefined;
  const lower = name.toLowerCase();
  if (accounts.some((account) => account.name.toLowerCase() === lower)) return undefined;
  return neutralize(name, 120);
}

function typeFromVerbs(text: string): 'income' | 'expense' | 'transfer' | undefined {
  const matches = (['expense', 'income', 'transfer'] as const).filter((type) =>
    VERBS[type].test(text),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function mostCommonCategory(
  examples: readonly CategorizedExample[],
  type: 'income' | 'expense',
  key: string,
): string | undefined {
  if (key.length < 3) return undefined;
  const counts = new Map<string, number>();
  for (const example of examples) {
    if (example.type === type && payeeKey(example.merchant, example.description) === key) {
      counts.set(example.categoryId, (counts.get(example.categoryId) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0];
}

export interface DraftContext {
  caller: Caller;
  refs: UserReferences;
  examples: readonly CategorizedExample[];
  now: Date;
}

/** Turns the person's sentence into a reviewable draft (never a saved transaction). */
export async function draftFromText(
  provider: AiProvider,
  text: string,
  { caller, refs, examples, now }: DraftContext,
  signal?: AbortSignal,
): Promise<TransactionDraftResultDto> {
  const today = calendarDateInTimeZone(now, caller.timeZone);
  const reading = readDate(text, today);
  const futureReason =
    'That describes something that has not happened yet, so there is nothing to record. Record it once the money has moved, or add it as a recurring payment.';
  if (reading.kind === 'future' || FUTURE_INTENT.test(text)) {
    return { kind: 'not_a_transaction', reason: futureReason };
  }

  const extracted = await generateStructured({
    provider,
    schema: extractionSchema,
    purpose: 'transaction_draft',
    maxOutputTokens: 200,
    signal,
    messages: [
      {
        role: 'system',
        content: `You read one sentence about the user's own money and extract its parts as JSON. Copy words from the sentence; do not invent values. Today is ${today}. ${DATA_RULES}`,
      },
      { role: 'user', content: `<data name="sentence">${neutralize(text, 500)}</data>` },
    ],
  });
  // Future intent was already ruled out above from the person's own words; a model's "future" or
  // "not a transaction" only counts when the sentence has no past-tense money verb.
  const reported = PAST_MONEY_VERBS.test(text);
  if (extracted.kind === 'future' && !reported) {
    return { kind: 'not_a_transaction', reason: futureReason };
  }
  if (extracted.kind === 'not_transaction' && !reported) {
    return {
      kind: 'not_a_transaction',
      reason:
        'That does not read like money you spent, received, or moved. Try something like “Spent 450 on groceries yesterday”.',
    };
  }

  const notes: DraftNoteDto[] = [];
  const questions: string[] = [];
  const type = typeFromVerbs(text) ?? extracted.type ?? undefined;
  if (type === undefined) {
    return {
      kind: 'clarification',
      question: 'Was this money you spent, money you received, or a move between your accounts?',
      draft: { type: 'expense', tags: [] },
      notes: [{ field: 'type', message: 'The type could not be told from the text.' }],
    };
  }

  const active = refs.accounts.filter((account) => account.status === 'active');
  const named = (phrase: string | null | undefined): AccountDto | undefined =>
    phrase === undefined || phrase === null ? undefined : matchByName(active, phrase);
  let source: AccountDto | undefined;
  let destination: AccountDto | undefined;
  if (type === 'transfer') {
    const fromTo = /\bfrom\s+(?:my\s+)?(.+?)\s+to\s+(?:my\s+)?(.+?)(?:[.,!]|$)/i.exec(text);
    source = named(fromTo?.[1]) ?? named(extracted.account);
    destination = named(fromTo?.[2]) ?? named(extracted.toAccount);
    if (source === undefined || destination === undefined || source.id === destination.id) {
      questions.push('Which of your accounts did the money move from, and which did it go to?');
      notes.push({ field: 'transferAccount', message: 'Choose both accounts of the transfer.' });
      if (destination?.id === source?.id) destination = undefined;
    }
  } else {
    source =
      named(extracted.account) ??
      (() => {
        const mentioned = active.filter((account) =>
          text.toLowerCase().includes(account.name.toLowerCase()),
        );
        return mentioned.length === 1 ? mentioned[0] : undefined;
      })();
    if (source === undefined && active.length === 1) {
      source = active[0];
      notes.push({ field: 'account', message: 'Your only active account was chosen.' });
    } else if (source === undefined) {
      questions.push(
        type === 'income'
          ? 'Which account did the money go into?'
          : 'Which account did you pay from?',
      );
      notes.push({ field: 'account', message: 'Choose the account.' });
    }
  }

  const mentioned = CURRENCY_WORDS.find(([pattern]) => pattern.test(text))?.[1];
  const currency: CurrencyCode = source?.currency ?? mentioned ?? caller.preferredCurrency;
  if (mentioned !== undefined && source !== undefined && mentioned !== source.currency) {
    notes.push({
      field: 'currency',
      message: `The text mentions ${mentioned}, but ${source.name} is in ${source.currency}.`,
    });
  }

  let amount: string | undefined;
  const rawAmount =
    (extracted.amount === undefined || extracted.amount === null
      ? undefined
      : amountInText(extracted.amount, text)) ?? soleAmount(text);
  if (rawAmount === undefined) {
    questions.push('How much was it?');
    notes.push({ field: 'amount', message: 'The amount could not be read with certainty.' });
  } else {
    const parsed = parseDecimalAmount(rawAmount, currency);
    if (parsed.ok && parsed.minorUnits > 0n) {
      amount = formatDecimalAmount(parsed.minorUnits, currency);
    } else {
      questions.push('How much was it?');
      notes.push({
        field: 'amount',
        message: parsed.ok
          ? 'The amount must be more than zero.'
          : `${describeDecimalAmountError(parsed.error, currency)} (${CURRENCIES[currency].name} uses ${CURRENCIES[currency].minorUnitDigits.toString()} decimals).`,
      });
    }
  }

  const date = reading.kind === 'date' ? reading.date : today;
  if (reading.kind === 'none')
    notes.push({ field: 'date', message: 'No date was mentioned, so today is used. Check it.' });
  const time = readTime(text);

  const counterparty =
    wordsInText(extracted.counterparty, text) ?? payeeAfterAt(text, refs.accounts);
  let categoryId: string | undefined;
  if (type !== 'transfer') {
    const usable = refs.categories.filter(
      (category: CategoryDto) => category.kind === type && category.status === 'active',
    );
    const byName =
      extracted.category === undefined || extracted.category === null
        ? undefined
        : matchByName(usable, extracted.category);
    const fromHistory = mostCommonCategory(
      examples,
      type,
      payeeKey(counterparty, extracted.description ?? text),
    );
    categoryId =
      byName?.id ??
      (usable.some((category) => category.id === fromHistory) ? fromHistory : undefined);
    if (categoryId === undefined) notes.push({ field: 'category', message: 'Choose a category.' });
  }

  const description =
    neutralize(extracted.description ?? counterparty ?? text, 255) || 'Transaction';
  const paymentMethod =
    type === 'transfer' ? undefined : PAYMENT_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1];
  const draft: TransactionDraftDto = {
    type,
    ...(amount === undefined ? {} : { amount }),
    currency,
    ...(source === undefined ? {} : { accountId: source.id }),
    ...(destination === undefined ? {} : { transferAccountId: destination.id }),
    date,
    ...(time === undefined ? {} : { time }),
    description,
    ...(counterparty === undefined || type === 'transfer' ? {} : { merchant: counterparty }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(paymentMethod === undefined ? {} : { paymentMethod }),
    tags: [],
  };
  const result: TransactionDraftResultDto =
    questions.length > 0
      ? { kind: 'clarification', question: questions.join(' '), draft, notes }
      : { kind: 'draft', draft, notes };
  // The same contract the web app validates; anything malformed is a server bug, not a guess.
  return transactionDraftResultDtoSchema.parse(result);
}
