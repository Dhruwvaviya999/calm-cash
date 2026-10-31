import {
  aiPreferencesDtoSchema,
  aiStatusDtoSchema,
  categorySuggestionDtoSchema,
  categorySuggestionsDtoSchema,
  conversationDetailDtoSchema,
  conversationDtoSchema,
  conversationListDtoSchema,
  financialReportDtoSchema,
  insightExplanationDtoSchema,
  merchantRuleDtoSchema,
  merchantSuggestionsDtoSchema,
  searchInterpretationDtoSchema,
  sendMessageResultDtoSchema,
  transactionDraftResultDtoSchema,
  type AiPreferencesDto,
  type AiStatusDto,
  type CategorySuggestionDto,
  type CategorySuggestionsDto,
  type ConversationDetailDto,
  type ConversationDto,
  type ConversationListDto,
  type EntityId,
  type ExplainInsightInput,
  type FinancialReportDto,
  type FinancialReportInput,
  type InsightExplanationDto,
  type MerchantRuleDto,
  type MerchantRuleInput,
  type MerchantSuggestionsDto,
  type SearchInterpretationDto,
  type SendMessageResultDto,
  type TransactionDraftResultDto,
} from '@calmcash/shared';
import { z } from 'zod';

import { api } from '@/lib/api';

// One function per AI endpoint; every response is validated against the shared schema. The
// browser only ever talks to the CalmCash API: the local model is reached by the server alone.
// Nothing here records or changes money — drafts and suggestions are applied through the ordinary
// transaction endpoints when the person confirms them.

const deletedSchema = z.object({ deleted: z.number().int().min(0) });
const acknowledgedSchema = z.object({}).loose();
const ruleListSchema = z.object({ items: z.array(merchantRuleDtoSchema) });
const entrySuggestionSchema = categorySuggestionDtoSchema.omit({ transactionId: true });

function conversationPath(conversationId: EntityId): `/${string}` {
  return `/ai/conversations/${encodeURIComponent(conversationId)}`;
}

export function getAiStatus(signal?: AbortSignal): Promise<AiStatusDto> {
  return api.request('/ai/status', { schema: aiStatusDtoSchema, signal });
}

export function updateAiPreferences(enabled: boolean): Promise<AiPreferencesDto> {
  return api.request('/ai/preferences', {
    schema: aiPreferencesDtoSchema,
    method: 'PATCH',
    body: { enabled },
  });
}

// --- Conversations -------------------------------------------------------------------------------

export function listConversations(signal?: AbortSignal): Promise<ConversationListDto> {
  return api.request('/ai/conversations', { schema: conversationListDtoSchema, signal });
}

export function createConversation(): Promise<ConversationDto> {
  return api.request('/ai/conversations', {
    schema: conversationDtoSchema,
    method: 'POST',
    body: {},
  });
}

export function getConversation(
  conversationId: EntityId,
  signal?: AbortSignal,
): Promise<ConversationDetailDto> {
  return api.request(conversationPath(conversationId), {
    schema: conversationDetailDtoSchema,
    signal,
  });
}

export function renameConversation(
  conversationId: EntityId,
  title: string,
): Promise<ConversationDto> {
  return api.request(conversationPath(conversationId), {
    schema: conversationDtoSchema,
    method: 'PATCH',
    body: { title },
  });
}

export async function deleteConversation(conversationId: EntityId): Promise<void> {
  await api.request(conversationPath(conversationId), { schema: deletedSchema, method: 'DELETE' });
}

/** Deletes every conversation of the signed-in person; resolves with how many there were. */
export async function clearConversations(): Promise<number> {
  return (await api.request('/ai/conversations', { schema: deletedSchema, method: 'DELETE' }))
    .deleted;
}

export function sendMessage(
  conversationId: EntityId,
  content: string,
  signal?: AbortSignal,
): Promise<SendMessageResultDto> {
  return api.request(`${conversationPath(conversationId)}/messages`, {
    schema: sendMessageResultDtoSchema,
    method: 'POST',
    body: { content },
    signal,
  });
}

// --- Drafts, suggestions, search -----------------------------------------------------------------

export function draftTransaction(
  text: string,
  signal?: AbortSignal,
): Promise<TransactionDraftResultDto> {
  return api.request('/ai/transaction-drafts', {
    schema: transactionDraftResultDtoSchema,
    method: 'POST',
    body: { text },
    signal,
  });
}

export function suggestCategories(transactionIds: EntityId[]): Promise<CategorySuggestionsDto> {
  return api.request('/ai/category-suggestions', {
    schema: categorySuggestionsDtoSchema,
    method: 'POST',
    body: { transactionIds },
  });
}

export function suggestEntryCategory(entry: {
  type: 'income' | 'expense';
  description: string;
  merchant?: string;
}): Promise<Omit<CategorySuggestionDto, 'transactionId'>> {
  return api.request('/ai/category-suggestions/entry', {
    schema: entrySuggestionSchema,
    method: 'POST',
    body: entry,
  });
}

export async function rejectCategorySuggestion(
  transactionId: EntityId,
  categoryId: EntityId,
): Promise<void> {
  await api.request('/ai/category-suggestions/reject', {
    schema: acknowledgedSchema,
    method: 'POST',
    body: { transactionId, categoryId },
  });
}

export function getMerchantSuggestions(signal?: AbortSignal): Promise<MerchantSuggestionsDto> {
  return api.request('/ai/merchant-suggestions', { schema: merchantSuggestionsDtoSchema, signal });
}

export async function dismissMerchantSuggestion(transactionId: EntityId): Promise<void> {
  await api.request('/ai/merchant-suggestions/dismiss', {
    schema: acknowledgedSchema,
    method: 'POST',
    body: { transactionId },
  });
}

export async function listMerchantRules(signal?: AbortSignal): Promise<MerchantRuleDto[]> {
  return (await api.request('/ai/merchant-rules', { schema: ruleListSchema, signal })).items;
}

export function saveMerchantRule(input: MerchantRuleInput): Promise<MerchantRuleDto> {
  return api.request('/ai/merchant-rules', {
    schema: merchantRuleDtoSchema,
    method: 'POST',
    body: input,
  });
}

export async function deleteMerchantRule(ruleId: EntityId): Promise<void> {
  await api.request(`/ai/merchant-rules/${encodeURIComponent(ruleId)}`, {
    schema: deletedSchema,
    method: 'DELETE',
  });
}

export function interpretSearch(
  query: string,
  signal?: AbortSignal,
): Promise<SearchInterpretationDto> {
  return api.request('/ai/search-interpretations', {
    schema: searchInterpretationDtoSchema,
    method: 'POST',
    body: { query },
    signal,
  });
}

// --- Reports and explanations --------------------------------------------------------------------

export function createReport(
  input: FinancialReportInput,
  signal?: AbortSignal,
): Promise<FinancialReportDto> {
  return api.request('/ai/reports', {
    schema: financialReportDtoSchema,
    method: 'POST',
    body: input,
    signal,
  });
}

export function explainInsight(input: ExplainInsightInput): Promise<InsightExplanationDto> {
  return api.request('/ai/insight-explanations', {
    schema: insightExplanationDtoSchema,
    method: 'POST',
    body: input,
  });
}
