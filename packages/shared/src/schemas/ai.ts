import { z } from 'zod';

import {
  AI_LIMITS,
  AI_PROBLEMS,
  AI_REPORT_KINDS,
  AI_TEXT_LIMITS,
  AI_TOOL_NAMES,
  CANDIDATE_STRENGTHS,
  MERCHANT_SUGGESTION_BASES,
  RECURRING_CANDIDATE_FREQUENCIES,
  SPENDING_INSIGHT_KINDS,
  SUGGESTION_BASES,
} from '../constants/ai';
import { AMOUNT_FILTER_PATTERN } from '../money/amount-filter';
import type {
  AiPreferencesDto,
  AiStatusDto,
  AssistantBlockDto,
  AssistantLinkDto,
  AssistantLinkTarget,
  CategorySuggestionInput,
  CategorySuggestionDto,
  CategorySuggestionsDto,
  ConversationDetailDto,
  ConversationDto,
  ConversationListDto,
  ConversationMessageDto,
  DismissSuggestionInput,
  ExplainInsightInput,
  FigureDto,
  FinancialReportDto,
  FinancialReportInput,
  InsightExplanationDto,
  InsightListDto,
  MerchantRuleDto,
  MerchantRuleInput,
  MerchantSuggestionsDto,
  RecurringCandidateListDto,
  RejectSuggestionInput,
  RenameConversationInput,
  SearchInterpretationDto,
  SearchInterpretationInput,
  SendMessageInput,
  SendMessageResultDto,
  SpendingInsightDto,
  TransactionDraftInput,
  TransactionDraftResultDto,
  TransactionLinkFilters,
  UpdateAiPreferencesInput,
} from '../types/ai';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
} from './common';
import { dashboardPeriodSchema, dashboardQuerySchema } from './dashboard';
import { paymentMethodSchema } from './transaction';

export const aiToolNameSchema = z.enum(AI_TOOL_NAMES);
export const aiProblemSchema = z.enum(AI_PROBLEMS);

/** Text a person typed: trimmed, bounded, no control characters other than tab and line breaks. */
function promptText(max: number, empty: string): z.ZodString {
  return z
    .string({ error: empty })
    .trim()
    .min(1, { error: empty })
    .max(max, { error: `Use at most ${max} characters.` })
    .refine((text) => !/\p{Cc}/u.test(text.replace(/[\t\n\r]/g, '')), {
      error: 'Remove unsupported characters.',
    });
}

const periodRangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema });

// --- Status and preferences ----------------------------------------------------------------------

export const aiStatusDtoSchema = z.object({
  available: z.boolean(),
  serverEnabled: z.boolean(),
  enabledForUser: z.boolean(),
  provider: z.literal('ollama'),
  model: z.string().min(1).max(100),
  modelInstalled: z.boolean().exactOptional(),
  lastCheckedAt: isoDateTimeSchema.exactOptional(),
  lastSuccessAt: isoDateTimeSchema.exactOptional(),
  problem: aiProblemSchema.exactOptional(),
}) satisfies z.ZodType<AiStatusDto>;

export const aiPreferencesDtoSchema = z.object({
  enabled: z.boolean(),
  updatedAt: isoDateTimeSchema.exactOptional(),
}) satisfies z.ZodType<AiPreferencesDto>;

export const updateAiPreferencesInputSchema = z.strictObject({
  enabled: z.boolean(),
}) satisfies z.ZodType<UpdateAiPreferencesInput>;

// --- Links and blocks ----------------------------------------------------------------------------

export const transactionLinkFiltersSchema = z.strictObject({
  type: z.enum(['income', 'expense', 'transfer']).exactOptional(),
  accountId: entityIdSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  currency: currencyCodeSchema.exactOptional(),
  from: isoDateSchema.exactOptional(),
  to: isoDateSchema.exactOptional(),
  q: z.string().trim().min(1).max(100).exactOptional(),
  minAmount: z.string().regex(AMOUNT_FILTER_PATTERN).exactOptional(),
  maxAmount: z.string().regex(AMOUNT_FILTER_PATTERN).exactOptional(),
  sort: z.enum(['newest', 'oldest', 'largest', 'smallest']).exactOptional(),
}) satisfies z.ZodType<TransactionLinkFilters>;

export const assistantLinkTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('transactions'), filters: transactionLinkFiltersSchema }),
  z.strictObject({ kind: z.literal('transaction'), transactionId: entityIdSchema }),
  z.strictObject({
    kind: z.literal('dashboard'),
    period: dashboardPeriodSchema,
    from: isoDateSchema.exactOptional(),
    to: isoDateSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
  }),
  z.strictObject({ kind: z.literal('budget'), budgetId: entityIdSchema }),
  z.strictObject({ kind: z.literal('budgets') }),
  z.strictObject({ kind: z.literal('accounts') }),
  z.strictObject({ kind: z.literal('recurring') }),
  z.strictObject({ kind: z.literal('subscriptions') }),
  z.strictObject({ kind: z.literal('goals') }),
  z.strictObject({ kind: z.literal('insights') }),
  z.strictObject({ kind: z.literal('scenarios') }),
]) satisfies z.ZodType<AssistantLinkTarget>;

export const assistantLinkDtoSchema = z.object({
  label: z.string().min(1).max(80),
  target: assistantLinkTargetSchema,
}) satisfies z.ZodType<AssistantLinkDto>;

export const figureDtoSchema = z.object({
  label: z.string().min(1).max(120),
  amountMinor: minorUnitsSchema.exactOptional(),
  text: z.string().min(1).max(120).exactOptional(),
}) satisfies z.ZodType<FigureDto>;

const transactionRefDtoSchema = z.object({
  id: entityIdSchema,
  occurredAt: isoDateTimeSchema,
  type: z.enum(['income', 'expense', 'transfer', 'balance_adjustment']),
  description: z.string().max(255),
  merchant: z.string().max(120).exactOptional(),
  category: z.string().max(120).exactOptional(),
  amountMinor: minorUnitsSchema,
  currency: currencyCodeSchema,
});

// --- Transaction drafts --------------------------------------------------------------------------

export const transactionDraftInputSchema = z.strictObject({
  text: promptText(AI_TEXT_LIMITS.draftText, 'Describe the transaction.'),
}) satisfies z.ZodType<TransactionDraftInput>;

const transactionDraftDtoSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer']),
  amount: z.string().regex(AMOUNT_FILTER_PATTERN).exactOptional(),
  currency: currencyCodeSchema.exactOptional(),
  accountId: entityIdSchema.exactOptional(),
  transferAccountId: entityIdSchema.exactOptional(),
  date: isoDateSchema.exactOptional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .exactOptional(),
  description: z.string().min(1).max(255).exactOptional(),
  merchant: z.string().min(1).max(120).exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
  notes: z.string().min(1).max(2000).exactOptional(),
  tags: z.array(z.string().min(1).max(32)).max(10),
});

const draftNoteDtoSchema = z.object({
  field: z.enum(['type', 'amount', 'account', 'transferAccount', 'date', 'category', 'currency']),
  message: z.string().min(1).max(200),
});

export const transactionDraftResultDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('draft'),
    draft: transactionDraftDtoSchema,
    notes: z.array(draftNoteDtoSchema),
  }),
  z.object({
    kind: z.literal('clarification'),
    question: z.string().min(1).max(300),
    draft: transactionDraftDtoSchema,
    notes: z.array(draftNoteDtoSchema),
  }),
  z.object({ kind: z.literal('not_a_transaction'), reason: z.string().min(1).max(300) }),
]) satisfies z.ZodType<TransactionDraftResultDto>;

export const assistantBlockDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('figures'),
    title: z.string().min(1).max(120),
    currency: currencyCodeSchema.exactOptional(),
    period: periodRangeSchema.exactOptional(),
    figures: z.array(figureDtoSchema).max(20),
  }),
  z.object({
    kind: z.literal('transactions'),
    title: z.string().min(1).max(120),
    items: z.array(transactionRefDtoSchema).max(AI_LIMITS.transactionsPerAnswer),
    totalCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('categories'),
    title: z.string().min(1).max(120),
    currency: currencyCodeSchema,
    period: periodRangeSchema,
    items: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          amountMinor: minorUnitsSchema,
          shareBasisPoints: z.string().regex(/^\d+$/),
        }),
      )
      .max(12),
  }),
  z.object({ kind: z.literal('links'), links: z.array(assistantLinkDtoSchema).max(6) }),
  z.object({
    kind: z.literal('notice'),
    tone: z.enum(['info', 'warning']),
    text: z.string().min(1).max(300),
  }),
  z.object({ kind: z.literal('transaction_draft'), result: transactionDraftResultDtoSchema }),
]) satisfies z.ZodType<AssistantBlockDto>;

// --- Conversations -------------------------------------------------------------------------------

export const conversationDtoSchema = z.object({
  id: entityIdSchema,
  title: z.string().min(1).max(AI_TEXT_LIMITS.conversationTitle),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<ConversationDto>;

export const conversationListDtoSchema = z.object({
  items: z.array(conversationDtoSchema).max(AI_LIMITS.conversations),
}) satisfies z.ZodType<ConversationListDto>;

export const conversationMessageDtoSchema = z.object({
  id: entityIdSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string().max(AI_TEXT_LIMITS.assistantContent),
  blocks: z.array(assistantBlockDtoSchema).max(8),
  followUps: z.array(z.string().min(1).max(160)).max(3),
  outcome: z.enum(['answered', 'clarification', 'unsupported', 'unavailable']).exactOptional(),
  narrative: z.enum(['assistant', 'template']).exactOptional(),
  createdAt: isoDateTimeSchema,
}) satisfies z.ZodType<ConversationMessageDto>;

export const conversationDetailDtoSchema = z.object({
  conversation: conversationDtoSchema,
  messages: z.array(conversationMessageDtoSchema).max(AI_LIMITS.messages),
}) satisfies z.ZodType<ConversationDetailDto>;

export const sendMessageInputSchema = z.strictObject({
  content: promptText(AI_TEXT_LIMITS.message, 'Type a question.'),
}) satisfies z.ZodType<SendMessageInput>;

export const sendMessageResultDtoSchema = z.object({
  conversation: conversationDtoSchema,
  userMessage: conversationMessageDtoSchema,
  assistantMessage: conversationMessageDtoSchema,
}) satisfies z.ZodType<SendMessageResultDto>;

export const renameConversationInputSchema = z.strictObject({
  title: promptText(AI_TEXT_LIMITS.conversationTitle, 'Give the conversation a title.'),
}) satisfies z.ZodType<RenameConversationInput>;

// --- Suggestions ---------------------------------------------------------------------------------

export const categorySuggestionInputSchema = z.strictObject({
  transactionIds: z
    .array(entityIdSchema)
    .min(1, { error: 'Choose at least one transaction.' })
    .max(AI_LIMITS.categorizeBatch, {
      error: `Ask for at most ${AI_LIMITS.categorizeBatch} suggestions at a time.`,
    }),
}) satisfies z.ZodType<CategorySuggestionInput>;

export const categorySuggestionDtoSchema = z.object({
  transactionId: entityIdSchema,
  categoryId: entityIdSchema.exactOptional(),
  basis: z.enum(SUGGESTION_BASES).exactOptional(),
  reason: z.string().min(1).max(200),
}) satisfies z.ZodType<CategorySuggestionDto>;

export const categorySuggestionsDtoSchema = z.object({
  items: z.array(categorySuggestionDtoSchema),
  assistantUsed: z.boolean(),
}) satisfies z.ZodType<CategorySuggestionsDto>;

export const rejectSuggestionInputSchema = z.strictObject({
  transactionId: entityIdSchema,
  categoryId: entityIdSchema,
}) satisfies z.ZodType<RejectSuggestionInput>;

export const merchantSuggestionsDtoSchema = z.object({
  items: z.array(
    z.object({
      transactionId: entityIdSchema,
      description: z.string().max(255),
      currentMerchant: z.string().max(120).exactOptional(),
      suggestedMerchant: z.string().min(1).max(AI_TEXT_LIMITS.merchant),
      basis: z.enum(MERCHANT_SUGGESTION_BASES),
      patternKey: z.string().min(1).max(120),
    }),
  ),
  assistantUsed: z.boolean(),
}) satisfies z.ZodType<MerchantSuggestionsDto>;

export const merchantRuleInputSchema = z.strictObject({
  patternKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9 ]+$/),
  merchant: promptText(AI_TEXT_LIMITS.merchant, 'Enter a merchant name.'),
}) satisfies z.ZodType<MerchantRuleInput>;

export const merchantRuleDtoSchema = z.object({
  id: entityIdSchema,
  patternKey: z.string().min(1).max(120),
  merchant: z.string().min(1).max(AI_TEXT_LIMITS.merchant),
  createdAt: isoDateTimeSchema,
}) satisfies z.ZodType<MerchantRuleDto>;

export const dismissSuggestionInputSchema = z.strictObject({
  transactionId: entityIdSchema,
}) satisfies z.ZodType<DismissSuggestionInput>;

// --- Insights ------------------------------------------------------------------------------------

/** Insight and report periods use the dashboard's period rules. */
export const insightQuerySchema = dashboardQuerySchema;

export const insightKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:._-]+$/);

export const spendingInsightDtoSchema = z.object({
  key: insightKeySchema,
  kind: z.enum(SPENDING_INSIGHT_KINDS),
  currency: currencyCodeSchema,
  period: periodRangeSchema,
  comparedTo: periodRangeSchema.exactOptional(),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(500),
  figures: z.array(figureDtoSchema).max(6),
  link: assistantLinkDtoSchema,
}) satisfies z.ZodType<SpendingInsightDto>;

export const insightListDtoSchema = z.object({
  period: periodRangeSchema,
  currency: currencyCodeSchema.exactOptional(),
  currencies: z.array(currencyCodeSchema),
  items: z.array(spendingInsightDtoSchema).max(20),
  insufficientHistory: z.boolean(),
}) satisfies z.ZodType<InsightListDto>;

export const explainInsightInputSchema = z
  .strictObject({
    key: insightKeySchema,
    period: dashboardPeriodSchema.default('last-month'),
    from: isoDateSchema.exactOptional(),
    to: isoDateSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
  })
  .refine(
    (input) => input.period !== 'custom' || (input.from !== undefined && input.to !== undefined),
    {
      error: 'A custom period needs a start and an end date.',
      path: ['from'],
    },
  ) satisfies z.ZodType<ExplainInsightInput>;

export const insightExplanationDtoSchema = z.object({
  key: insightKeySchema,
  explanation: z.string().min(1).max(1200),
  narrative: z.enum(['assistant', 'template']),
}) satisfies z.ZodType<InsightExplanationDto>;

export const recurringCandidateListDtoSchema = z.object({
  items: z.array(
    z.object({
      key: insightKeySchema,
      label: z.string().min(1).max(255),
      merchant: z.string().max(120).exactOptional(),
      currency: currencyCodeSchema,
      typicalAmountMinor: minorUnitsSchema,
      minAmountMinor: minorUnitsSchema,
      maxAmountMinor: minorUnitsSchema,
      frequency: z.enum(RECURRING_CANDIDATE_FREQUENCIES),
      lastDate: isoDateSchema,
      nextEstimatedDate: isoDateSchema,
      occurrences: z.number().int().min(3),
      transactionIds: z.array(entityIdSchema).max(24),
      accountId: entityIdSchema.exactOptional(),
      categoryId: entityIdSchema.exactOptional(),
      strength: z.enum(CANDIDATE_STRENGTHS),
      evidence: z.string().min(1).max(400),
      likelySubscription: z.boolean(),
    }),
  ),
}) satisfies z.ZodType<RecurringCandidateListDto>;

// --- Search --------------------------------------------------------------------------------------

export const searchInterpretationInputSchema = z.strictObject({
  query: promptText(AI_TEXT_LIMITS.searchQuery, 'Describe what to find.'),
}) satisfies z.ZodType<SearchInterpretationInput>;

export const searchInterpretationDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('filters'),
    query: z.string(),
    filters: transactionLinkFiltersSchema,
    chips: z.array(
      z.object({
        key: z.enum([
          'type',
          'accountId',
          'categoryId',
          'currency',
          'from',
          'to',
          'q',
          'minAmount',
          'maxAmount',
          'sort',
        ]),
        label: z.string().min(1).max(120),
      }),
    ),
    unresolved: z.array(z.string().min(1).max(120)).max(5),
  }),
  z.object({
    kind: z.literal('not_understood'),
    query: z.string(),
    reason: z.string().min(1).max(300),
  }),
]) satisfies z.ZodType<SearchInterpretationDto>;

// --- Reports -------------------------------------------------------------------------------------

export const financialReportInputSchema = z
  .strictObject({
    kind: z.enum(AI_REPORT_KINDS),
    period: dashboardPeriodSchema.default('last-month'),
    from: isoDateSchema.exactOptional(),
    to: isoDateSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
  })
  .refine(
    (input) => input.period !== 'custom' || (input.from !== undefined && input.to !== undefined),
    {
      error: 'A custom period needs a start and an end date.',
      path: ['from'],
    },
  ) satisfies z.ZodType<FinancialReportInput>;

export const financialReportDtoSchema = z.object({
  kind: z.enum(AI_REPORT_KINDS),
  period: periodRangeSchema,
  currency: currencyCodeSchema.exactOptional(),
  title: z.string().min(1).max(160),
  sections: z.array(assistantBlockDtoSchema).max(8),
  narrative: z.string().min(1).max(2000),
  narrativeSource: z.enum(['assistant', 'template']),
  generatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<FinancialReportDto>;
