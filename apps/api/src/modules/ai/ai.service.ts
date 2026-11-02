import {
  AI_LIMITS,
  calendarDateInTimeZone,
  type AiPreferencesDto,
  type AiStatusDto,
  type CategoryDto,
  type CategorySuggestionDto,
  type CategorySuggestionsDto,
  type ConversationDetailDto,
  type ConversationDto,
  type ConversationListDto,
  type ConversationMessageDto,
  type ExplainInsightInput,
  type FinancialReportDto,
  type FinancialReportInput,
  type InsightExplanationDto,
  type MerchantRuleDto,
  type MerchantSuggestionsDto,
  type SearchInterpretationDto,
  type SendMessageResultDto,
  type TransactionDraftResultDto,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { formatMoney } from '../../lib/text-format';
import type { AiRepository, ConversationRecord, MessageRecord } from './ai.repository';
import { readBlocks } from './ai.repository';
import { answerQuestion, titleFrom } from './assistant';
import { draftFromText } from './drafts';
import { narrate } from './narration';
import { AI_PROBLEM_MESSAGES, AiUnavailableError, type AiProvider } from './provider/ai-provider';
import { buildReport } from './reports';
import { interpretSearch } from './search';
import { suggestCategories, suggestCategoryForEntry, suggestMerchants } from './suggestions';
import type { ToolContext, ToolServices, UserReferences } from './tools';
import type { CategoriesService } from '../categories/categories.service';
import type { TransactionsService } from '../transactions/transactions.service';

export interface AiService {
  status: (caller: Caller) => Promise<AiStatusDto>;
  preferences: (caller: Caller) => Promise<AiPreferencesDto>;
  updatePreferences: (caller: Caller, enabled: boolean) => Promise<AiPreferencesDto>;
  conversations: (caller: Caller) => Promise<ConversationListDto>;
  createConversation: (caller: Caller) => Promise<ConversationDto>;
  conversation: (caller: Caller, conversationId: string) => Promise<ConversationDetailDto>;
  renameConversation: (
    caller: Caller,
    conversationId: string,
    title: string,
  ) => Promise<ConversationDto>;
  deleteConversation: (caller: Caller, conversationId: string) => Promise<void>;
  clearConversations: (caller: Caller) => Promise<number>;
  sendMessage: (
    caller: Caller,
    conversationId: string,
    content: string,
  ) => Promise<SendMessageResultDto>;
  draft: (caller: Caller, text: string) => Promise<TransactionDraftResultDto>;
  categorySuggestions: (
    caller: Caller,
    transactionIds: readonly string[],
  ) => Promise<CategorySuggestionsDto>;
  entryCategorySuggestion: (
    caller: Caller,
    entry: { type: 'income' | 'expense'; description: string; merchant?: string | undefined },
  ) => Promise<Omit<CategorySuggestionDto, 'transactionId'>>;
  rejectCategory: (caller: Caller, transactionId: string, categoryId: string) => Promise<void>;
  merchantSuggestions: (caller: Caller) => Promise<MerchantSuggestionsDto>;
  merchantRules: (caller: Caller) => Promise<MerchantRuleDto[]>;
  saveMerchantRule: (
    caller: Caller,
    patternKey: string,
    merchant: string,
  ) => Promise<MerchantRuleDto>;
  deleteMerchantRule: (caller: Caller, ruleId: string) => Promise<void>;
  dismissMerchant: (caller: Caller, transactionId: string) => Promise<void>;
  interpretSearch: (caller: Caller, query: string) => Promise<SearchInterpretationDto>;
  report: (caller: Caller, input: FinancialReportInput) => Promise<FinancialReportDto>;
  explainInsight: (caller: Caller, input: ExplainInsightInput) => Promise<InsightExplanationDto>;
}

export interface AiServiceDependencies {
  repository: AiRepository;
  provider: AiProvider;
  /** `AI_ENABLED`, the operator's switch. */
  serverEnabled: boolean;
  tools: ToolServices;
  categories: Pick<CategoriesService, 'list'>;
  accounts: ToolServices['accounts'];
  transactions: Pick<TransactionsService, 'get' | 'list'>;
  now: () => Date;
}

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That conversation does not exist or is not yours.');

function unavailable(problem: AiUnavailableError['problem']): AppError {
  return problem === 'disabled_by_user' || problem === 'disabled_by_server'
    ? new AppError(403, 'AI_DISABLED', AI_PROBLEM_MESSAGES[problem])
    : new AppError(503, 'AI_UNAVAILABLE', AI_PROBLEM_MESSAGES[problem]);
}

function toConversationDto(row: ConversationRecord): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessageDto(row: MessageRecord): ConversationMessageDto {
  const outcome =
    row.outcome === 'answered' ||
    row.outcome === 'clarification' ||
    row.outcome === 'unsupported' ||
    row.outcome === 'unavailable'
      ? row.outcome
      : undefined;
  const narrative =
    row.narrative === 'assistant' || row.narrative === 'template' ? row.narrative : undefined;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    blocks: readBlocks(row.blocks),
    followUps: row.followUps.slice(0, 3),
    ...(outcome === undefined ? {} : { outcome }),
    ...(narrative === undefined ? {} : { narrative }),
    createdAt: row.createdAt.toISOString(),
  };
}

export function createAiService({
  repository,
  provider,
  serverEnabled,
  tools,
  categories,
  accounts,
  transactions,
  now,
}: AiServiceDependencies): AiService {
  const enabledForUser = async (caller: Caller): Promise<boolean> =>
    (await repository.preference(caller.userId))?.enabled ?? true;

  /** The provider when AI may run for this person now; otherwise the reason as an error. */
  const requireAi = async (caller: Caller): Promise<AiProvider> => {
    if (!serverEnabled) throw unavailable('disabled_by_server');
    if (!(await enabledForUser(caller))) throw unavailable('disabled_by_user');
    const status = await provider.status();
    if (status.problem !== undefined) throw unavailable(status.problem);
    return provider;
  };

  /** Like `requireAi`, but deterministic features continue without the model. */
  const optionalAi = async (caller: Caller): Promise<AiProvider | undefined> => {
    try {
      return await requireAi(caller);
    } catch {
      return undefined;
    }
  };

  const references = async (caller: Caller): Promise<UserReferences> => {
    const [accountList, categoryList] = await Promise.all([
      accounts.list(caller, { status: 'all' }),
      categories.list(caller),
    ]);
    return {
      accounts: accountList.accounts.map((entry) => entry.account),
      categories: categoryList.categories,
    };
  };

  const toolContext = async (caller: Caller): Promise<ToolContext> => ({
    caller,
    services: tools,
    today: calendarDateInTimeZone(now(), caller.timeZone),
    refs: await references(caller),
  });

  const ownConversation = async (
    caller: Caller,
    conversationId: string,
  ): Promise<ConversationRecord> => {
    const row = await repository.conversation(caller.userId, conversationId);
    if (row === null) throw notFound();
    return row;
  };

  const categoryList = async (caller: Caller): Promise<CategoryDto[]> =>
    (await categories.list(caller)).categories;

  return {
    status: async (caller) => {
      const status = await provider.status();
      const userOn = await enabledForUser(caller);
      const problem = !serverEnabled
        ? 'disabled_by_server'
        : !userOn
          ? 'disabled_by_user'
          : status.problem;
      return {
        available: problem === undefined,
        serverEnabled,
        enabledForUser: userOn,
        provider: 'ollama',
        model: provider.model,
        ...(status.modelInstalled === undefined ? {} : { modelInstalled: status.modelInstalled }),
        lastCheckedAt: status.checkedAt.toISOString(),
        ...(status.lastSuccessAt === undefined
          ? {}
          : { lastSuccessAt: status.lastSuccessAt.toISOString() }),
        ...(problem === undefined ? {} : { problem }),
      };
    },

    preferences: async (caller) => {
      const row = await repository.preference(caller.userId);
      return row === null
        ? { enabled: true }
        : { enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
    },

    updatePreferences: async (caller, enabled) => {
      const row = await repository.setPreference(caller.userId, enabled);
      return { enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
    },

    conversations: async (caller) => ({
      items: (await repository.conversations(caller.userId, AI_LIMITS.conversations)).map(
        toConversationDto,
      ),
    }),

    createConversation: async (caller) =>
      toConversationDto(await repository.createConversation(caller.userId, 'New conversation')),

    conversation: async (caller, conversationId) => {
      const row = await ownConversation(caller, conversationId);
      const messages = await repository.messages(caller.userId, row.id, AI_LIMITS.messages);
      return { conversation: toConversationDto(row), messages: messages.map(toMessageDto) };
    },

    renameConversation: async (caller, conversationId, title) => {
      if (!(await repository.renameConversation(caller.userId, conversationId, title)))
        throw notFound();
      return toConversationDto(await ownConversation(caller, conversationId));
    },

    deleteConversation: async (caller, conversationId) => {
      if (!(await repository.deleteConversation(caller.userId, conversationId))) throw notFound();
    },

    clearConversations: (caller) => repository.deleteAllConversations(caller.userId),

    sendMessage: async (caller, conversationId, content) => {
      const conversation = await ownConversation(caller, conversationId);
      const ai = await requireAi(caller);
      const history = await repository.messages(
        caller.userId,
        conversation.id,
        AI_LIMITS.historyForContext,
      );
      const context = await toolContext(caller);
      const reply = await answerQuestion(content, history, {
        provider: ai,
        context,
        examples: () => repository.categorizedExamples(caller.userId, 2_000),
        now: now(),
      });
      if (reply.outcome === 'unavailable') {
        // Nothing is stored for a turn the model could not run; the person can simply retry.
        throw new AppError(503, 'AI_UNAVAILABLE', reply.content);
      }
      const [userMessage, assistantMessage] = await repository.addMessages(
        caller.userId,
        conversation.id,
        [{ role: 'user', content, blocks: [], followUps: [] }, reply],
      );
      if (conversation.title === 'New conversation' && history.length === 0) {
        await repository.renameConversation(caller.userId, conversation.id, titleFrom(content));
      }
      const updated = await ownConversation(caller, conversation.id);
      if (userMessage === undefined || assistantMessage === undefined) {
        throw new Error('Messages were not stored.');
      }
      return {
        conversation: toConversationDto(updated),
        userMessage: toMessageDto(userMessage),
        assistantMessage: toMessageDto(assistantMessage),
      };
    },

    draft: async (caller, text) => {
      const ai = await requireAi(caller);
      try {
        return await draftFromText(ai, text, {
          caller,
          refs: await references(caller),
          examples: await repository.categorizedExamples(caller.userId, 2_000),
          now: now(),
        });
      } catch (error: unknown) {
        if (error instanceof AiUnavailableError) throw unavailable(error.problem);
        throw error;
      }
    },

    categorySuggestions: async (caller, transactionIds) =>
      suggestCategories(caller, transactionIds, await categoryList(caller), {
        repository,
        transactions,
        provider: await optionalAi(caller),
      }),

    entryCategorySuggestion: async (caller, entry) =>
      suggestCategoryForEntry(caller, entry, await categoryList(caller), {
        repository,
        provider: await optionalAi(caller),
      }),

    rejectCategory: async (caller, transactionId, categoryId) => {
      await transactions.get(caller, transactionId); // 404 unless it is the caller's
      await repository.dismiss(caller.userId, 'category', transactionId, categoryId);
    },

    merchantSuggestions: async (caller) =>
      suggestMerchants(caller, { repository, transactions, provider: await optionalAi(caller) }),

    merchantRules: async (caller) =>
      (await repository.merchantRules(caller.userId)).map((rule) => ({
        id: rule.id,
        patternKey: rule.patternKey,
        merchant: rule.merchant,
        createdAt: rule.createdAt.toISOString(),
      })),

    saveMerchantRule: async (caller, patternKey, merchant) => {
      const rule = await repository.saveMerchantRule(caller.userId, patternKey, merchant);
      return {
        id: rule.id,
        patternKey: rule.patternKey,
        merchant: rule.merchant,
        createdAt: rule.createdAt.toISOString(),
      };
    },

    deleteMerchantRule: async (caller, ruleId) => {
      if (!(await repository.deleteMerchantRule(caller.userId, ruleId))) {
        throw new AppError(404, 'NOT_FOUND', 'That rule does not exist or is not yours.');
      }
    },

    dismissMerchant: async (caller, transactionId) => {
      await transactions.get(caller, transactionId);
      await repository.dismiss(caller.userId, 'merchant', transactionId);
    },

    interpretSearch: async (caller, query) => {
      const ai = await requireAi(caller);
      try {
        return await interpretSearch(ai, caller, query, await references(caller), now());
      } catch (error: unknown) {
        if (error instanceof AiUnavailableError) throw unavailable(error.problem);
        throw error;
      }
    },

    report: async (caller, input) =>
      buildReport(await optionalAi(caller), input, await toolContext(caller), now()),

    explainInsight: async (caller, input) => {
      const { key, ...query } = input;
      const insights = await tools.insights.list(caller, query);
      const insight = insights.items.find((item) => item.key === key);
      if (insight === undefined) {
        throw new AppError(
          404,
          'NOT_FOUND',
          'That insight is not available for this period any more.',
        );
      }
      const facts = [
        insight.title,
        insight.detail,
        ...insight.figures.map((figure) =>
          [
            figure.label,
            figure.amountMinor === undefined
              ? undefined
              : formatMoney(figure.amountMinor, insight.currency),
            figure.text,
          ]
            .filter((part) => part !== undefined)
            .join(': '),
        ),
      ];
      const narration = await narrate(await optionalAi(caller), {
        question: 'Explain this observation in plain words, without guessing why it happened.',
        facts,
        template: insight.detail,
        purpose: 'insight_explanation',
      });
      return { key, explanation: narration.text, narrative: narration.source };
    },
  };
}
