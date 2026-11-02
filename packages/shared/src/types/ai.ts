import type {
  AiProblem,
  AiReportKind,
  CandidateStrength,
  MerchantSuggestionBasis,
  RecurringCandidateFrequency,
  SpendingInsightKind,
  SuggestionBasis,
} from '../constants/ai';
import type { CurrencyCode } from '../constants/currencies';
import type { DashboardPeriod } from '../constants/dashboard';
import type { PaymentMethod } from '../constants/domain';
import type { EntityId, IsoDateString, IsoDateTimeString, MinorUnitsString } from './common';

// Contracts of the AI features. Model output never reaches these DTOs unchecked: the API
// validates it, resolves every name to the signed-in user's own records, and builds the figures
// from deterministic services. Nothing here is an account, transaction, or budget record — those
// keep their own DTOs.

// --- Status and preferences ----------------------------------------------------------------------

export interface AiStatusDto {
  /** AI features can answer right now (server on, user on, model reachable and installed). */
  available: boolean;
  /** The server operator enabled AI (`AI_ENABLED`). */
  serverEnabled: boolean;
  /** The person's own switch in Settings → AI & Privacy. */
  enabledForUser: boolean;
  provider: 'ollama';
  /** Configured model name (never a URL or host). */
  model: string;
  /** Unknown until the first check. */
  modelInstalled?: boolean;
  lastCheckedAt?: IsoDateTimeString;
  lastSuccessAt?: IsoDateTimeString;
  problem?: AiProblem;
}

export interface AiPreferencesDto {
  enabled: boolean;
  updatedAt?: IsoDateTimeString;
}

export interface UpdateAiPreferencesInput {
  enabled: boolean;
}

// --- Links and answer blocks ---------------------------------------------------------------------

/** Transaction filters as the transactions page reads them from its URL. */
export interface TransactionLinkFilters {
  type?: 'income' | 'expense' | 'transfer';
  accountId?: EntityId;
  categoryId?: EntityId;
  currency?: CurrencyCode;
  from?: IsoDateString;
  to?: IsoDateString;
  q?: string;
  minAmount?: string;
  maxAmount?: string;
  sort?: 'newest' | 'oldest' | 'largest' | 'smallest';
}

/** Where a link in an answer leads: identifiers and filters only, never a URL. */
export type AssistantLinkTarget =
  | { kind: 'transactions'; filters: TransactionLinkFilters }
  | { kind: 'transaction'; transactionId: EntityId }
  | {
      kind: 'dashboard';
      period: DashboardPeriod;
      from?: IsoDateString;
      to?: IsoDateString;
      currency?: CurrencyCode;
    }
  | { kind: 'budget'; budgetId: EntityId }
  | { kind: 'budgets' }
  | { kind: 'accounts' }
  | { kind: 'recurring' }
  | { kind: 'subscriptions' }
  | { kind: 'goals' }
  | { kind: 'insights' };

export interface AssistantLinkDto {
  label: string;
  target: AssistantLinkTarget;
}

export interface FigureDto {
  label: string;
  /** A money amount in the block's currency. */
  amountMinor?: MinorUnitsString;
  /** Any other value, already worded (a percentage, a count, "not available"). */
  text?: string;
}

export interface TransactionRefDto {
  id: EntityId;
  occurredAt: IsoDateTimeString;
  type: 'income' | 'expense' | 'transfer' | 'balance_adjustment';
  description: string;
  merchant?: string;
  category?: string;
  amountMinor: MinorUnitsString;
  currency: CurrencyCode;
}

export interface CategoryShareDto {
  name: string;
  amountMinor: MinorUnitsString;
  shareBasisPoints: string;
}

/** Parts of an answer. Every figure in them comes from a deterministic service. */
export type AssistantBlockDto =
  | {
      kind: 'figures';
      title: string;
      currency?: CurrencyCode;
      period?: { from: IsoDateString; to: IsoDateString };
      figures: FigureDto[];
    }
  | {
      kind: 'transactions';
      title: string;
      items: TransactionRefDto[];
      /** All matches (the list may show fewer). */
      totalCount: number;
    }
  | {
      kind: 'categories';
      title: string;
      currency: CurrencyCode;
      period: { from: IsoDateString; to: IsoDateString };
      items: CategoryShareDto[];
    }
  | { kind: 'links'; links: AssistantLinkDto[] }
  | { kind: 'notice'; tone: 'info' | 'warning'; text: string }
  /** A proposed transaction: shown for review, saved only by the person through the form. */
  | { kind: 'transaction_draft'; result: TransactionDraftResultDto };

// --- Conversations -------------------------------------------------------------------------------

export interface ConversationDto {
  id: EntityId;
  title: string;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface ConversationListDto {
  items: ConversationDto[];
}

/**
 * How an assistant message came about: `answered` (from the tools), `clarification` (a question
 * back), `unsupported` (outside what it can do), `unavailable` (AI could not run).
 */
export type AssistantOutcome = 'answered' | 'clarification' | 'unsupported' | 'unavailable';

export interface ConversationMessageDto {
  id: EntityId;
  role: 'user' | 'assistant';
  /** Plain text (a small Markdown subset: paragraphs, lists, bold). */
  content: string;
  blocks: AssistantBlockDto[];
  followUps: string[];
  outcome?: AssistantOutcome;
  /** Whether the wording came from the model or from a fixed template (figures never do). */
  narrative?: 'assistant' | 'template';
  createdAt: IsoDateTimeString;
}

export interface ConversationDetailDto {
  conversation: ConversationDto;
  messages: ConversationMessageDto[];
}

export interface SendMessageInput {
  content: string;
}

export interface SendMessageResultDto {
  conversation: ConversationDto;
  userMessage: ConversationMessageDto;
  assistantMessage: ConversationMessageDto;
}

export interface RenameConversationInput {
  title: string;
}

// --- Transaction drafts --------------------------------------------------------------------------

export interface TransactionDraftInput {
  text: string;
}

/** A proposed transaction for the entry form. Never saved by the API on its own. */
export interface TransactionDraftDto {
  type: 'income' | 'expense' | 'transfer';
  /** Major units as typed, e.g. `"450"` (validated with the account's currency). */
  amount?: string;
  currency?: CurrencyCode;
  accountId?: EntityId;
  transferAccountId?: EntityId;
  /** Calendar date in the user's time zone. */
  date?: IsoDateString;
  /** `HH:mm`, when the text says so. */
  time?: string;
  description?: string;
  merchant?: string;
  categoryId?: EntityId;
  paymentMethod?: PaymentMethod;
  notes?: string;
  tags: string[];
}

export interface DraftNoteDto {
  field: 'type' | 'amount' | 'account' | 'transferAccount' | 'date' | 'category' | 'currency';
  message: string;
}

export type TransactionDraftResultDto =
  | { kind: 'draft'; draft: TransactionDraftDto; notes: DraftNoteDto[] }
  | { kind: 'clarification'; question: string; draft: TransactionDraftDto; notes: DraftNoteDto[] }
  | { kind: 'not_a_transaction'; reason: string };

// --- Suggestions ---------------------------------------------------------------------------------

export interface CategorySuggestionInput {
  transactionIds: EntityId[];
}

export interface CategorySuggestionDto {
  transactionId: EntityId;
  /** Absent when there is no suggestion worth showing (the transaction stays uncategorised). */
  categoryId?: EntityId;
  basis?: SuggestionBasis;
  reason: string;
}

export interface CategorySuggestionsDto {
  items: CategorySuggestionDto[];
  /** False when only your own history was used (AI off or unavailable). */
  assistantUsed: boolean;
}

export interface RejectSuggestionInput {
  transactionId: EntityId;
  categoryId: EntityId;
}

export interface MerchantSuggestionDto {
  transactionId: EntityId;
  description: string;
  currentMerchant?: string;
  suggestedMerchant: string;
  basis: MerchantSuggestionBasis;
  /** Identifies the description pattern a remembered rule would apply to. */
  patternKey: string;
}

export interface MerchantSuggestionsDto {
  items: MerchantSuggestionDto[];
  assistantUsed: boolean;
}

export interface MerchantRuleInput {
  patternKey: string;
  merchant: string;
}

export interface MerchantRuleDto {
  id: EntityId;
  patternKey: string;
  merchant: string;
  createdAt: IsoDateTimeString;
}

export interface DismissSuggestionInput {
  transactionId: EntityId;
}

// --- Insights ------------------------------------------------------------------------------------

export interface InsightQuery {
  period: DashboardPeriod;
  from?: IsoDateString;
  to?: IsoDateString;
  currency?: CurrencyCode;
}

/** A pattern found by deterministic rules; the wording here is fixed text, not model output. */
export interface SpendingInsightDto {
  key: string;
  kind: SpendingInsightKind;
  currency: CurrencyCode;
  period: { from: IsoDateString; to: IsoDateString };
  comparedTo?: { from: IsoDateString; to: IsoDateString };
  title: string;
  detail: string;
  figures: FigureDto[];
  link: AssistantLinkDto;
}

export interface InsightListDto {
  period: { from: IsoDateString; to: IsoDateString };
  currency?: CurrencyCode;
  currencies: CurrencyCode[];
  items: SpendingInsightDto[];
  /** Too little history for comparisons (fewer than the documented minimums). */
  insufficientHistory: boolean;
}

export interface ExplainInsightInput extends InsightQuery {
  key: string;
}

export interface InsightExplanationDto {
  key: string;
  explanation: string;
  narrative: 'assistant' | 'template';
}

export interface RecurringCandidateDto {
  key: string;
  label: string;
  merchant?: string;
  currency: CurrencyCode;
  typicalAmountMinor: MinorUnitsString;
  minAmountMinor: MinorUnitsString;
  maxAmountMinor: MinorUnitsString;
  frequency: RecurringCandidateFrequency;
  lastDate: IsoDateString;
  /** An estimate from the observed rhythm, never a scheduled date. */
  nextEstimatedDate: IsoDateString;
  occurrences: number;
  transactionIds: EntityId[];
  accountId?: EntityId;
  categoryId?: EntityId;
  strength: CandidateStrength;
  evidence: string;
  /** The category or name suggests a subscription (streaming, software, …). */
  likelySubscription: boolean;
}

export interface RecurringCandidateListDto {
  items: RecurringCandidateDto[];
}

// --- Natural-language search ---------------------------------------------------------------------

export interface SearchInterpretationInput {
  query: string;
}

export interface FilterChipDto {
  key: keyof TransactionLinkFilters;
  label: string;
}

export type SearchInterpretationDto =
  | {
      kind: 'filters';
      query: string;
      filters: TransactionLinkFilters;
      chips: FilterChipDto[];
      /** Parts of the question that matched none of your records (shown, not guessed). */
      unresolved: string[];
    }
  | { kind: 'not_understood'; query: string; reason: string };

// --- Reports -------------------------------------------------------------------------------------

export interface FinancialReportInput {
  kind: AiReportKind;
  period: DashboardPeriod;
  from?: IsoDateString;
  to?: IsoDateString;
  currency?: CurrencyCode;
}

export interface FinancialReportDto {
  kind: AiReportKind;
  period: { from: IsoDateString; to: IsoDateString };
  currency?: CurrencyCode;
  title: string;
  sections: AssistantBlockDto[];
  narrative: string;
  narrativeSource: 'assistant' | 'template';
  generatedAt: IsoDateTimeString;
}
