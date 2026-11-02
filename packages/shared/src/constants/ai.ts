// AI features (Phase 10). The model runs on a locally hosted Ollama server reached only by the API;
// it never decides a financial figure. Every amount the assistant shows comes from the same
// deterministic services as the rest of CalmCash; the model only plans which of them to ask and
// writes the explanation around their answers.

/**
 * Financial tools the assistant may ask the server to run. The server owns this list: a tool name
 * the model invents is refused, and every tool runs as the signed-in user.
 */
export const AI_TOOL_NAMES = [
  'getFinancialOverview',
  'getAccountPositions',
  'searchTransactions',
  'getCategorySpending',
  'compareFinancialPeriods',
  'getBudgetStatus',
  'getUpcomingPayments',
  'getSubscriptions',
  'getSavingsGoals',
  'getSpendingPatterns',
  'getTopMerchants',
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** Why AI features cannot answer right now. */
export const AI_PROBLEMS = [
  'disabled_by_server',
  'disabled_by_user',
  'unreachable',
  'model_missing',
  'busy',
  'timeout',
  'invalid_output',
] as const;

export type AiProblem = (typeof AI_PROBLEMS)[number];

/** Where a category suggestion came from (shown to the person; not a probability). */
export const SUGGESTION_BASES = ['your_history', 'assistant'] as const;
export type SuggestionBasis = (typeof SUGGESTION_BASES)[number];

/** Where a merchant suggestion came from. */
export const MERCHANT_SUGGESTION_BASES = ['your_rule', 'pattern', 'assistant'] as const;
export type MerchantSuggestionBasis = (typeof MERCHANT_SUGGESTION_BASES)[number];

export const SPENDING_INSIGHT_KINDS = [
  'category_increase',
  'category_decrease',
  'unusual_expense',
  'frequent_merchant',
  'income_change',
] as const;

export type SpendingInsightKind = (typeof SPENDING_INSIGHT_KINDS)[number];

export const RECURRING_CANDIDATE_FREQUENCIES = [
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;
export type RecurringCandidateFrequency = (typeof RECURRING_CANDIDATE_FREQUENCIES)[number];

/**
 * `strong`: at least five payments, every interval within tolerance, amounts within 5 % of the
 * typical one. `possible`: at least three payments and most intervals within tolerance.
 */
export const CANDIDATE_STRENGTHS = ['strong', 'possible'] as const;
export type CandidateStrength = (typeof CANDIDATE_STRENGTHS)[number];

export const AI_REPORT_KINDS = [
  'period',
  'categories',
  'merchants',
  'subscriptions',
  'budgets',
] as const;
export type AiReportKind = (typeof AI_REPORT_KINDS)[number];

/** What the person dismissed or rejected, so it is not offered again unchanged. */
export const AI_DISMISSAL_KINDS = [
  'category',
  'merchant',
  'recurring_candidate',
  'insight',
] as const;
export type AiDismissalKind = (typeof AI_DISMISSAL_KINDS)[number];

export const AI_TEXT_LIMITS = {
  message: 1000,
  draftText: 500,
  searchQuery: 200,
  conversationTitle: 80,
  assistantContent: 4000,
  merchant: 120,
} as const;

/** Bounds of one request (the server enforces them; the model never sees more). */
export const AI_LIMITS = {
  /** Category suggestions per request. */
  categorizeBatch: 10,
  /** Merchant suggestions per request. */
  merchantSuggestions: 20,
  /** Conversations listed (newest first). */
  conversations: 50,
  /** Messages returned with a conversation (newest). */
  messages: 50,
  /** Earlier messages the assistant reads for context. */
  historyForContext: 6,
  /** Tool calls the assistant may make for one question. */
  toolCallsPerQuestion: 3,
  /** Transactions a tool returns (and an answer shows). */
  transactionsPerAnswer: 10,
} as const;
