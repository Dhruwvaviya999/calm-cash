import {
  addDaysToIsoDate,
  AI_LIMITS,
  AI_TOOL_NAMES,
  FORECAST_HORIZONS,
  presetRange,
  SCENARIO_HORIZONS,
  type FinancialScenarioDto,
  type SpendingPatternsQuery,
  currencyCodeSchema,
  addMonthsToIsoDate,
  transactionListQuerySchema,
  type AccountDto,
  type AssistantBlockDto,
  type AssistantLinkDto,
  type CategoryDto,
  type CurrencyCode,
  type DashboardQuery,
  type FigureDto,
  type TransactionLinkFilters,
} from '@calmcash/shared';
import { z } from 'zod';

import type { Caller } from '../../lib/auth-boundary';
import { formatBasisPoints, formatDate, formatMoney, formatRange } from '../../lib/text-format';
import type { AccountsService } from '../accounts/accounts.service';
import type { BudgetsService } from '../budgets/budgets.service';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { GoalsService } from '../goals/goals.service';
import { changeBp } from '../insights/patterns';
import type { InsightsService } from '../insights/insights.service';
import type { IntelligenceService } from '../intelligence/intelligence.service';
import { normalizeNumber, numbersIn } from './grounding';
import {
  budgetFacts,
  cashFlowFacts,
  goalFacts,
  healthFacts,
  patternsFacts,
  recommendationFacts,
  scenarioFacts,
  spendingForecastFacts,
} from './intelligence-facts';
import type { RecurringService } from '../recurring/recurring.service';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { TransactionsService } from '../transactions/transactions.service';

// The assistant's tools: an explicit allowlist of read-only questions the server can answer from
// the existing services. The model never supplies an identifier, SQL, a path, or a URL — it names
// a tool and a few plain fields (a period, a category or account *name*, a search word). The
// server resolves names against the signed-in user's own records, builds strictly validated
// arguments, calls the service as that user, and bounds every result. No tool writes anything.

const PERIOD_PRESETS = [
  'this-month',
  'last-month',
  'last-3-months',
  'last-6-months',
  'this-year',
] as const;

/** What the model may put in one tool call (every field optional, plain values only). */
export const toolCallPlanSchema = z.object({
  tool: z.enum(AI_TOOL_NAMES).describe('Which tool to run.'),
  period: z.enum(PERIOD_PRESETS).nullish().describe('Reporting period; default this-month.'),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullish()
    .describe('A single calendar month instead of period, as YYYY-MM.'),
  compareWith: z
    .enum(PERIOD_PRESETS)
    .nullish()
    .describe('compareFinancialPeriods only: the other period.'),
  currency: z
    .string()
    .max(3)
    .nullish()
    .describe('Three-letter currency code, only if the user named one.'),
  type: z.enum(['income', 'expense', 'transfer']).nullish(),
  category: z.string().max(60).nullish().describe('A category name the user mentioned.'),
  account: z.string().max(60).nullish().describe('An account name the user mentioned.'),
  text: z.string().max(60).nullish().describe('A merchant or word to search for.'),
  minAmount: z.string().max(20).nullish(),
  maxAmount: z.string().max(20).nullish(),
  sort: z.enum(['newest', 'largest']).nullish(),
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .nullish()
    .describe('getUpcomingPayments, getCashFlowForecast, runFinancialScenario: days ahead.'),
  forecastPeriod: z
    .enum(['this-month', 'next-month'])
    .nullish()
    .describe('getCategorySpendingForecast only.'),
  scenario: z
    .string()
    .max(80)
    .nullish()
    .describe('runFinancialScenario: the name of a saved scenario the user mentioned.'),
  percent: z
    .number()
    .min(1)
    .max(100)
    .nullish()
    .describe('runFinancialScenario: a percentage the user wrote, e.g. 15.'),
  direction: z.enum(['decrease', 'increase']).nullish().describe('runFinancialScenario only.'),
  goal: z.string().max(60).nullish().describe('A savings-goal name the user mentioned.'),
});

export type ToolCallPlan = z.output<typeof toolCallPlanSchema>;

export interface ToolServices {
  dashboard: Pick<DashboardService, 'overview' | 'categories'>;
  accounts: Pick<AccountsService, 'summary' | 'list'>;
  transactions: Pick<TransactionsService, 'list' | 'summary'>;
  budgets: Pick<BudgetsService, 'list'>;
  recurring: Pick<RecurringService, 'upcoming'>;
  subscriptions: Pick<SubscriptionsService, 'list'>;
  goals: Pick<GoalsService, 'list'>;
  insights: Pick<InsightsService, 'list' | 'topPayees'>;
  intelligence: Pick<
    IntelligenceService,
    | 'cashFlowForecast'
    | 'spendingForecast'
    | 'spendingPatterns'
    | 'financialHealth'
    | 'goalProjections'
    | 'budgetRecommendations'
    | 'recommendations'
    | 'listScenarios'
    | 'runScenario'
    | 'previewScenario'
  >;
}

export interface UserReferences {
  accounts: readonly AccountDto[];
  categories: readonly CategoryDto[];
}

export interface ToolContext {
  caller: Caller;
  services: ToolServices;
  today: string;
  refs: UserReferences;
  /** The person's question; a number a tool acts on must appear in it (never one the model chose). */
  question?: string;
}

export interface ToolOutcome {
  blocks: AssistantBlockDto[];
  links: AssistantLinkDto[];
  /** One plain line per fact, exactly as shown (the model's only source of numbers). */
  facts: string[];
  /** A fixed sentence used when the model's wording is not used. */
  summary: string;
  /** Names the user mentioned that match none of their records. */
  unresolved: string[];
}

/** Short descriptions the planner reads. */
export const TOOL_DESCRIPTIONS: Readonly<Record<(typeof AI_TOOL_NAMES)[number], string>> = {
  getFinancialOverview: 'income, spending, net cash flow, savings rate for a period',
  getAccountPositions: 'money held and owed now, per currency (assets and credit cards/loans)',
  searchTransactions:
    'find transactions by type, category, account, words, amounts, period; sort newest or largest',
  getCategorySpending: 'spending per category for a period',
  compareFinancialPeriods: 'compare income and spending of period with compareWith',
  getBudgetStatus: 'budgets: spent, limit, and whether over',
  getUpcomingPayments: 'expected bills and income in the next days, and overdue ones',
  getSubscriptions: 'subscriptions and their estimated yearly cost',
  getSavingsGoals: 'savings goals: saved, target, remaining',
  getSpendingPatterns: 'notable changes, unusual expenses, frequent merchants in a period',
  getTopMerchants: 'merchants paid most often in a period',
  getCashFlowForecast:
    'estimated money position in the coming days (days: 7, 30, 60, or 90) from schedules and typical spending',
  getCategorySpendingForecast:
    'estimated spending per category by the end of this month or next month (forecastPeriod)',
  getFinancialHealth:
    'explainable indicators: savings rate, budgets, bills against income, money held',
  getSavingsGoalProjection:
    'when savings goals could be reached and how much is needed per month (goal)',
  getBudgetRecommendations:
    'suggested budget limits from past months, and budgets often exceeded (category)',
  runFinancialScenario:
    'what-if: a saved scenario by name (scenario), or spending in a category changed by a percent (category, percent, direction, days)',
  getAdvancedSpendingPatterns:
    'detailed history for a period: categories, merchants, typical and largest expenses',
  explainFinancialRecommendation:
    'current recommendations with their evidence (text: words of one)',
};

// --- Argument resolution -------------------------------------------------------------------------

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The one record whose name matches (exactly, else uniquely by containment); never a guess. */
export function matchByName<T extends { name: string }>(
  items: readonly T[],
  wanted: string,
): T | undefined {
  const target = normalizeName(wanted);
  if (target.length < 2) return undefined;
  const exact = items.filter((item) => normalizeName(item.name) === target);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((item) => {
    const name = normalizeName(item.name);
    return name.includes(target) || target.includes(name);
  });
  return partial.length === 1 ? partial[0] : undefined;
}

function currencyOf(call: ToolCallPlan): CurrencyCode | undefined {
  const parsed = currencyCodeSchema.safeParse(call.currency?.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

/** A dashboard query from a preset or a month; months in the future are refused. */
export function periodQuery(
  call: ToolCallPlan,
  today: string,
  preset = call.period,
): DashboardQuery {
  const currency = currencyOf(call);
  const base = currency === undefined ? {} : { currency };
  if (preset === undefined || preset === null) {
    if (call.month !== undefined && call.month !== null) {
      const from = `${call.month}-01`;
      if (from <= today && from >= '1900-01-01') {
        const end = addDaysToIsoDate(addMonthsToIsoDate(from, 1), -1);
        return { period: 'custom', from, to: end < today ? end : today, ...base };
      }
    }
    return { period: 'this-month', ...base };
  }
  return { period: preset, ...base };
}

function amountText(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const plain = value.replace(/[^\d.]/g, '');
  return /^\d{1,15}(\.\d{1,3})?$/.test(plain) ? plain : undefined;
}

// --- Facts ---------------------------------------------------------------------------------------

function figureLine(figure: FigureDto, currency: CurrencyCode | undefined): string {
  const parts = [figure.label];
  if (figure.amountMinor !== undefined && currency !== undefined)
    parts.push(formatMoney(figure.amountMinor, currency));
  if (figure.text !== undefined) parts.push(figure.text);
  return parts.join(': ');
}

/** Plain lines for every figure in the blocks (what the model may repeat). */
export function factLines(blocks: readonly AssistantBlockDto[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'figures':
        lines.push(
          `${block.title}${block.period === undefined ? '' : ` (${formatRange(block.period.from, block.period.to)})`}${block.currency === undefined ? '' : `, ${block.currency}`}`,
        );
        for (const figure of block.figures) lines.push(`- ${figureLine(figure, block.currency)}`);
        break;
      case 'transactions':
        lines.push(`${block.title}: ${block.totalCount.toString()} matching`);
        for (const item of block.items) {
          lines.push(
            `- ${item.occurredAt.slice(0, 10)} ${item.merchant ?? item.description}: ${formatMoney(item.amountMinor, item.currency)} (${item.type})`,
          );
        }
        break;
      case 'categories':
        lines.push(
          `${block.title} (${formatRange(block.period.from, block.period.to)}), ${block.currency}`,
        );
        for (const item of block.items) {
          lines.push(
            `- ${item.name}: ${formatMoney(item.amountMinor, block.currency)} (${formatBasisPoints(BigInt(item.shareBasisPoints))} of spending)`,
          );
        }
        break;
      case 'notice':
        lines.push(block.text);
        break;
      case 'links':
      case 'transaction_draft':
        break;
    }
  }
  return lines;
}

function outcome(
  blocks: AssistantBlockDto[],
  links: AssistantLinkDto[],
  summary: string,
  unresolved: string[] = [],
): ToolOutcome {
  return { blocks, links, facts: factLines(blocks), summary, unresolved };
}

function dashboardLink(query: DashboardQuery, currency: CurrencyCode): AssistantLinkDto {
  return {
    label: 'Open the dashboard for this period',
    target: {
      kind: 'dashboard',
      period: query.period,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      currency,
    },
  };
}

// --- Intelligence tools (Phase 11) --------------------------------------------------------------

type ToolExecutor = (call: ToolCallPlan, context: ToolContext) => Promise<ToolOutcome>;

function notice(text: string, tone: 'info' | 'warning' = 'info'): AssistantBlockDto {
  return { kind: 'notice', tone, text };
}

/** The smallest allowed horizon that covers `days` (30 days by default). */
function horizonFor<const T extends readonly number[]>(
  allowed: T,
  days: number | null | undefined,
): T[number] | undefined {
  const wanted = days ?? 30;
  return allowed.find((value) => value >= wanted) ?? allowed.at(-1);
}

/** Dashboard-style presets in the plan, mapped to the historical-analysis periods. */
function patternQuery(call: ToolCallPlan, today: string): SpendingPatternsQuery {
  const currency = currencyOf(call);
  const base = currency === undefined ? {} : { currency };
  switch (call.period) {
    case 'this-month':
    case 'last-month': {
      const range = presetRange(call.period, today);
      return { period: 'custom', from: range.from, to: range.to, ...base };
    }
    case 'last-6-months':
      return { period: 'last-6-months', ...base };
    case 'this-year':
      return { period: 'this-year', ...base };
    case 'last-3-months':
    case null:
    case undefined:
      return { period: 'last-90-days', ...base };
  }
}

const intelligenceExecutors = {
  getCashFlowForecast: async (call, { caller, services }) => {
    const currency = currencyOf(call);
    const dto = await services.intelligence.cashFlowForecast(caller, {
      horizon: horizonFor(FORECAST_HORIZONS, call.days) ?? 30,
      income: 'scheduled',
      ...(currency === undefined ? {} : { currency }),
    });
    const facts = cashFlowFacts(dto);
    return outcome(
      facts.blocks,
      [{ label: 'Open forecasts', target: { kind: 'insights' } }],
      facts.summary,
    );
  },

  getCategorySpendingForecast: async (call, { caller, services }) => {
    const currency = currencyOf(call);
    const dto = await services.intelligence.spendingForecast(caller, {
      period: call.forecastPeriod ?? 'this-month',
      ...(currency === undefined ? {} : { currency }),
    });
    const facts = spendingForecastFacts(dto);
    return outcome(
      facts.blocks,
      [{ label: 'Open forecasts', target: { kind: 'insights' } }],
      facts.summary,
    );
  },

  getFinancialHealth: async (call, { caller, services }) => {
    const currency = currencyOf(call);
    const dto = await services.intelligence.financialHealth(
      caller,
      currency === undefined ? {} : { currency },
    );
    const facts = healthFacts(dto);
    return outcome(
      facts.blocks,
      [{ label: 'Open insights', target: { kind: 'insights' } }],
      facts.summary,
    );
  },

  getSavingsGoalProjection: async (call, { caller, services }) => {
    const { goals } = await services.intelligence.goalProjections(caller);
    const unresolved: string[] = [];
    let chosen = goals;
    if (call.goal !== undefined && call.goal !== null) {
      const match = matchByName(goals, call.goal);
      if (match === undefined) unresolved.push(call.goal);
      else chosen = [match];
    }
    const facts = goalFacts(chosen);
    return outcome(
      facts.blocks,
      [{ label: 'Open savings goals', target: { kind: 'goals' } }],
      facts.summary,
      unresolved,
    );
  },

  getBudgetRecommendations: async (call, { caller, services }) => {
    const currency = currencyOf(call);
    const dto = await services.intelligence.budgetRecommendations(
      caller,
      currency === undefined ? {} : { currency },
    );
    const unresolved: string[] = [];
    let items = dto.items;
    if (call.category !== undefined && call.category !== null) {
      const match = matchByName(
        items.map((item) => ({ key: item.key, name: item.categoryName })),
        call.category,
      );
      if (match === undefined) unresolved.push(call.category);
      else items = items.filter((item) => item.key === match.key);
    }
    const facts = budgetFacts({ ...dto, items });
    return outcome(
      facts.blocks,
      [{ label: 'Open budgets', target: { kind: 'budgets' } }],
      facts.summary,
      unresolved,
    );
  },

  runFinancialScenario: async (call, { caller, services, refs, question }) => {
    const links: AssistantLinkDto[] = [{ label: 'Open scenarios', target: { kind: 'scenarios' } }];
    const named = call.scenario?.trim() ?? '';
    if (named !== '') {
      const saved: FinancialScenarioDto[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const list = await services.intelligence.listScenarios(caller, { page });
        saved.push(...list.items);
        if (page >= list.pagination.totalPages) break;
      }
      const match = matchByName(saved, named);
      if (match === undefined) {
        return outcome(
          [notice(`You have no saved scenario called “${named.slice(0, 40)}”.`)],
          links,
          'No saved scenario matches that name.',
          [named],
        );
      }
      const facts = scenarioFacts(await services.intelligence.runScenario(caller, match.id));
      return outcome(facts.blocks, links, facts.summary);
    }
    const percent = call.percent ?? undefined;
    const categoryName = call.category ?? undefined;
    // The percentage must be one the person wrote, never one the model picked.
    const written =
      percent !== undefined && numbersIn(question ?? '').includes(normalizeNumber(String(percent)));
    const percentBp = percent === undefined ? undefined : Math.round(percent * 100);
    if (
      percentBp === undefined ||
      categoryName === undefined ||
      !written ||
      percentBp !== percent * 100
    ) {
      return outcome(
        [
          notice(
            'Name a saved scenario, or say a category and a percentage, e.g. “What if I spend 15% less on dining?”.',
          ),
        ],
        links,
        'I need a saved scenario, or a category and a percentage you wrote, to run a simulation.',
      );
    }
    const category = matchByName(
      refs.categories.filter((item) => item.kind === 'expense' && item.parentId === undefined),
      categoryName,
    );
    if (category === undefined) {
      return outcome(
        [
          notice(
            `No main expense category of yours is called “${categoryName.slice(0, 40)}”.`,
            'warning',
          ),
        ],
        links,
        'That category could not be found among yours.',
        [categoryName],
      );
    }
    const direction = call.direction ?? 'decrease';
    const result = await services.intelligence.previewScenario(caller, {
      name: `${direction === 'decrease' ? 'Less' : 'More'} ${category.name}`.slice(0, 80),
      currency: currencyOf(call) ?? caller.preferredCurrency,
      horizonDays: horizonFor(SCENARIO_HORIZONS, call.days) ?? 30,
      adjustments: [
        {
          kind: 'category_spending',
          categoryId: category.id,
          direction,
          change: { by: 'percent', percentBp },
        },
      ],
    });
    const facts = scenarioFacts(result);
    return outcome(facts.blocks, links, facts.summary);
  },

  getAdvancedSpendingPatterns: async (call, { caller, services, today }) => {
    const facts = patternsFacts(
      await services.intelligence.spendingPatterns(caller, patternQuery(call, today)),
    );
    return outcome(
      facts.blocks,
      [{ label: 'Open insights', target: { kind: 'insights' } }],
      facts.summary,
    );
  },

  explainFinancialRecommendation: async (call, { caller, services }) => {
    const currency = currencyOf(call);
    const { items } = await services.intelligence.recommendations(
      caller,
      currency === undefined ? {} : { currency },
    );
    const words = (call.text ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3);
    const matching =
      words.length === 0
        ? items
        : items.filter((item) => words.some((word) => item.title.toLowerCase().includes(word)));
    const facts = recommendationFacts(matching.length === 0 ? items : matching);
    return outcome(
      facts.blocks,
      [{ label: 'Open insights', target: { kind: 'insights' } }],
      facts.summary,
    );
  },
} satisfies Readonly<Record<string, ToolExecutor>>;

// --- Tools ---------------------------------------------------------------------------------------

const executors: Readonly<Record<(typeof AI_TOOL_NAMES)[number], ToolExecutor>> = {
  ...intelligenceExecutors,
  getFinancialOverview: async (call, { caller, services, today }) => {
    const query = periodQuery(call, today);
    const overview = await services.dashboard.overview(caller, query);
    const { cashFlow, period } = overview;
    const savings =
      overview.savingsRate.status === 'available'
        ? formatBasisPoints(BigInt(overview.savingsRate.basisPoints))
        : 'not available (no income in this period)';
    return outcome(
      [
        {
          kind: 'figures',
          title: 'Cash flow',
          currency: overview.currency,
          period: { from: period.from, to: period.to },
          figures: [
            {
              label: 'Money in',
              amountMinor: cashFlow.incomeMinor,
              text: `${cashFlow.incomeCount.toString()} income entries`,
            },
            {
              label: 'Money out',
              amountMinor: cashFlow.expenseMinor,
              text: `${cashFlow.expenseCount.toString()} expenses`,
            },
            { label: 'Net cash flow', amountMinor: cashFlow.netMinor },
            { label: 'Savings rate', text: savings },
          ],
        },
      ],
      [dashboardLink(query, overview.currency)],
      `Here is your cash flow for ${formatRange(period.from, period.to)} in ${overview.currency}. Transfers, balance adjustments, and voided transactions are not counted.`,
    );
  },

  getAccountPositions: async (_call, { caller, services }) => {
    const summary = await services.accounts.summary(caller);
    const blocks: AssistantBlockDto[] = summary.currencies.map((entry) => ({
      kind: 'figures',
      title: 'Where you stand now',
      currency: entry.currency,
      figures: [
        {
          label: 'Money held',
          amountMinor: entry.assetsMinor,
          text: `${entry.assetAccounts.toString()} accounts`,
        },
        {
          label: 'Amount owed',
          amountMinor: entry.liabilitiesMinor,
          text: `${entry.liabilityAccounts.toString()} cards or loans`,
        },
        {
          label: 'Net position',
          amountMinor: (BigInt(entry.assetsMinor) - BigInt(entry.liabilitiesMinor)).toString(),
        },
      ],
    }));
    return outcome(
      blocks.length > 0
        ? blocks
        : [{ kind: 'notice', tone: 'info', text: 'You have no active accounts yet.' }],
      [{ label: 'Open accounts', target: { kind: 'accounts' } }],
      'These are your current balances, per currency; currencies are never added together.',
    );
  },

  searchTransactions: async (call, { caller, services, today, refs }) => {
    const unresolved: string[] = [];
    const filters: TransactionLinkFilters = {};
    if (call.type !== undefined && call.type !== null) filters.type = call.type;
    if (call.category !== undefined && call.category !== null) {
      const category = matchByName(refs.categories, call.category);
      if (category === undefined) unresolved.push(call.category);
      else filters.categoryId = category.id;
    }
    if (call.account !== undefined && call.account !== null) {
      const account = matchByName(refs.accounts, call.account);
      if (account === undefined) unresolved.push(call.account);
      else filters.accountId = account.id;
    }
    const q = call.text?.trim();
    if (q !== undefined && q.length > 0) filters.q = q.slice(0, 100);
    const minAmount = amountText(call.minAmount);
    const maxAmount = amountText(call.maxAmount);
    if (minAmount !== undefined) filters.minAmount = minAmount;
    if (maxAmount !== undefined) filters.maxAmount = maxAmount;
    const currency = currencyOf(call);
    if (currency !== undefined) filters.currency = currency;
    if ((call.period ?? null) !== null || (call.month ?? null) !== null) {
      const query = periodQuery(call, today);
      const overview = await services.dashboard.overview(caller, query);
      filters.from = overview.period.from;
      filters.to = overview.period.to;
    }
    filters.sort = call.sort === 'largest' ? 'largest' : 'newest';
    // The service's own query schema validates everything (strings, as from a URL).
    const query = transactionListQuerySchema.parse({
      ...Object.fromEntries(Object.entries(filters).filter(([key]) => key !== 'sort')),
      sort: filters.sort,
      page: '1',
      pageSize: String(AI_LIMITS.transactionsPerAnswer),
    });
    const { sort: _sort, page: _page, pageSize: _size, ...filterQuery } = query;
    const [page, summary] = await Promise.all([
      services.transactions.list(caller, query),
      services.transactions.summary(caller, filterQuery),
    ]);
    const blocks: AssistantBlockDto[] = [
      {
        kind: 'transactions',
        title: 'Matching transactions',
        totalCount: page.pagination.totalItems,
        items: page.items.map(({ transaction, category }) => ({
          id: transaction.id,
          occurredAt: transaction.occurredAt,
          type: transaction.type,
          description: transaction.description,
          ...(transaction.type === 'income' || transaction.type === 'expense'
            ? transaction.merchant === undefined
              ? {}
              : { merchant: transaction.merchant }
            : {}),
          ...(category === undefined ? {} : { category: category.name }),
          amountMinor: transaction.amountMinor,
          currency: transaction.currency,
        })),
      },
      ...summary.currencies.map((entry): AssistantBlockDto => ({
        kind: 'figures',
        title: 'Totals of the matches',
        currency: entry.currency,
        ...(filters.from === undefined || filters.to === undefined
          ? {}
          : { period: { from: filters.from, to: filters.to } }),
        figures: [
          {
            label: 'Money in',
            amountMinor: entry.incomeMinor,
            text: `${entry.incomeCount.toString()} entries`,
          },
          {
            label: 'Money out',
            amountMinor: entry.expenseMinor,
            text: `${entry.expenseCount.toString()} entries`,
          },
        ],
      })),
    ];
    if (unresolved.length > 0) {
      blocks.push({
        kind: 'notice',
        tone: 'warning',
        text: `No category or account of yours is called ${unresolved.map((name) => `“${name.slice(0, 40)}”`).join(' or ')}, so that part was left out.`,
      });
    }
    return outcome(
      blocks,
      [{ label: 'View all matches', target: { kind: 'transactions', filters } }],
      page.pagination.totalItems === 0
        ? 'No transactions match that.'
        : `I found ${page.pagination.totalItems.toString()} matching transactions.`,
      unresolved,
    );
  },

  getCategorySpending: async (call, { caller, services, today }) => {
    const query = periodQuery(call, today);
    const result = await services.dashboard.categories(caller, query);
    const items = result.entries.map((entry) => ({
      name:
        entry.kind === 'category'
          ? entry.name
          : entry.kind === 'other'
            ? 'Other categories'
            : 'Uncategorised',
      amountMinor: entry.amountMinor,
      shareBasisPoints: entry.shareBasisPoints,
    }));
    return outcome(
      items.length > 0
        ? [
            {
              kind: 'categories',
              title: 'Spending by category',
              currency: result.currency,
              period: { from: result.period.from, to: result.period.to },
              items,
            },
          ]
        : [{ kind: 'notice', tone: 'info', text: 'No expenses were recorded in this period.' }],
      [dashboardLink(query, result.currency)],
      `Spending by category for ${formatRange(result.period.from, result.period.to)} in ${result.currency}, ${formatMoney(result.totalExpenseMinor, result.currency)} in total.`,
    );
  },

  compareFinancialPeriods: async (call, { caller, services, today }) => {
    const first = periodQuery(call, today);
    const second = periodQuery(call, today, call.compareWith ?? 'last-month');
    const a = await services.dashboard.overview(caller, first);
    const b = await services.dashboard.overview(caller, { ...second, currency: a.currency });
    const change = (now: string, before: string): string => {
      const value = changeBp(BigInt(before), BigInt(now));
      return value === undefined
        ? 'no earlier amount'
        : `${value >= 0n ? '+' : '−'}${formatBasisPoints(value < 0n ? -value : value)}`;
    };
    const label = (from: string, to: string): string => formatRange(from, to);
    const aLabel = label(a.period.from, a.period.to);
    const bLabel = label(b.period.from, b.period.to);
    return outcome(
      [
        {
          kind: 'figures',
          title: `${aLabel} compared with ${bLabel}`,
          currency: a.currency,
          figures: [
            { label: `Money in, ${aLabel}`, amountMinor: a.cashFlow.incomeMinor },
            {
              label: `Money in, ${bLabel}`,
              amountMinor: b.cashFlow.incomeMinor,
              text: change(a.cashFlow.incomeMinor, b.cashFlow.incomeMinor),
            },
            { label: `Money out, ${aLabel}`, amountMinor: a.cashFlow.expenseMinor },
            {
              label: `Money out, ${bLabel}`,
              amountMinor: b.cashFlow.expenseMinor,
              text: change(a.cashFlow.expenseMinor, b.cashFlow.expenseMinor),
            },
            { label: `Net, ${aLabel}`, amountMinor: a.cashFlow.netMinor },
            { label: `Net, ${bLabel}`, amountMinor: b.cashFlow.netMinor },
          ],
        },
      ],
      [dashboardLink(first, a.currency)],
      `Comparing ${aLabel} with ${bLabel} in ${a.currency}. A change shows that recorded amounts differ, not why.`,
    );
  },

  getBudgetStatus: async (_call, { caller, services, today }) => {
    const { budgets } = await services.budgets.list(caller, { status: 'active', date: today });
    const current = budgets.filter((item) => item.progress.timing === 'current');
    const byCurrency = new Map<CurrencyCode, typeof current>();
    for (const item of current)
      byCurrency.set(item.budget.currency, [...(byCurrency.get(item.budget.currency) ?? []), item]);
    const words: Record<string, string> = {
      on_track: 'on track',
      approaching_limit: 'near its limit',
      limit_reached: 'at its limit',
      over_budget: 'over budget',
      not_applicable: 'not started',
    };
    const blocks: AssistantBlockDto[] = [...byCurrency.entries()].map(([currency, items]) => ({
      kind: 'figures',
      title: 'Budgets this period',
      currency,
      figures: items.slice(0, 8).map((item) => ({
        label: `${item.budget.name} (${words[item.progress.status] ?? item.progress.status})`,
        amountMinor: item.progress.spentMinor,
        text: `spent of ${formatMoney(item.progress.limitMinor, currency)}`,
      })),
    }));
    const over = current.filter((item) => item.progress.status === 'over_budget');
    return outcome(
      blocks.length > 0
        ? blocks
        : [
            {
              kind: 'notice',
              tone: 'info',
              text: 'You have no active budgets for the current period.',
            },
          ],
      [
        ...over.slice(0, 3).map((item) => ({
          label: `Open ${item.budget.name}`,
          target: { kind: 'budget' as const, budgetId: item.budget.id },
        })),
        { label: 'Open budgets', target: { kind: 'budgets' } },
      ],
      over.length === 0
        ? 'None of your current budgets is over its limit.'
        : `${over.length.toString()} of your current budgets ${over.length === 1 ? 'is' : 'are'} over the limit.`,
    );
  },

  getUpcomingPayments: async (call, { caller, services, today }) => {
    const days = call.days ?? 30;
    const to = addDaysToIsoDate(today, days);
    const upcoming = await services.recurring.upcoming(caller, { from: today, to });
    const pending = upcoming.items.filter((item) =>
      ['upcoming', 'due', 'overdue'].includes(item.occurrence.status),
    );
    const blocks: AssistantBlockDto[] = upcoming.pendingTotals.map((total) => ({
      kind: 'figures',
      title: 'Expected — not yet paid or received',
      currency: total.currency,
      period: { from: today, to },
      figures: [
        {
          label: 'Expected payments',
          amountMinor: total.expectedExpenseMinor,
          text: `${total.expenseCount.toString()} payments`,
        },
        {
          label: 'Expected income',
          amountMinor: total.expectedIncomeMinor,
          text: `${total.incomeCount.toString()} entries`,
        },
        ...pending
          .filter((item) => item.occurrence.currency === total.currency)
          .slice(0, 6)
          .map((item) => ({
            label: `${item.schedule.name}, ${item.occurrence.status === 'overdue' ? 'overdue since' : 'due'} ${formatDate(item.occurrence.dueDate)}`,
            amountMinor: item.occurrence.amountMinor,
          })),
      ],
    }));
    return outcome(
      blocks.length > 0
        ? blocks
        : [
            {
              kind: 'notice',
              tone: 'info',
              text: 'No recurring payments are expected in this period.',
            },
          ],
      [{ label: 'Open bills and recurring payments', target: { kind: 'recurring' } }],
      `Payments expected from ${formatRange(today, to)}, including ${upcoming.overdueCount.toString()} overdue. These are plans from your schedules, not money that has moved.`,
    );
  },

  getSubscriptions: async (_call, { caller, services }) => {
    const { subscriptions } = await services.subscriptions.list(caller, { status: 'current' });
    const active = subscriptions.filter((item) => item.status === 'active');
    const byCurrency = new Map<CurrencyCode, typeof active>();
    for (const item of active)
      byCurrency.set(item.schedule.currency, [
        ...(byCurrency.get(item.schedule.currency) ?? []),
        item,
      ]);
    const blocks: AssistantBlockDto[] = [...byCurrency.entries()].map(([currency, items]) => ({
      kind: 'figures',
      title: 'Subscriptions — estimated cost over the next 12 months',
      currency,
      figures: [...items]
        .sort((x, y) =>
          BigInt(y.nextTwelveMonths.amountMinor) > BigInt(x.nextTwelveMonths.amountMinor) ? 1 : -1,
        )
        .slice(0, 8)
        .map((item) => ({
          label: item.schedule.name,
          amountMinor: item.nextTwelveMonths.amountMinor,
          text: `estimate, ${item.nextTwelveMonths.occurrences.toString()} charges`,
        })),
    }));
    return outcome(
      blocks.length > 0
        ? blocks
        : [{ kind: 'notice', tone: 'info', text: 'You have no active subscriptions.' }],
      [{ label: 'Open subscriptions', target: { kind: 'subscriptions' } }],
      'Estimated subscription costs from the details you entered; nothing here was detected from a bank.',
    );
  },

  getSavingsGoals: async (_call, { caller, services }) => {
    const { goals } = await services.goals.list(caller, { status: 'current' });
    const blocks: AssistantBlockDto[] = goals.slice(0, 8).map((item) => ({
      kind: 'figures',
      title: item.goal.name,
      currency: item.goal.currency,
      figures: [
        { label: 'Set aside', amountMinor: item.progress.savedMinor },
        { label: 'Target', amountMinor: item.goal.targetMinor },
        { label: 'Remaining', amountMinor: item.progress.remainingMinor },
        {
          label: 'Progress',
          text:
            item.progress.percent.status === 'available'
              ? formatBasisPoints(BigInt(item.progress.percent.basisPoints))
              : 'not available',
        },
      ],
    }));
    return outcome(
      blocks.length > 0
        ? blocks
        : [{ kind: 'notice', tone: 'info', text: 'You have no savings goals yet.' }],
      [{ label: 'Open savings goals', target: { kind: 'goals' } }],
      'Goal progress is what you set aside in CalmCash; it does not move money between accounts.',
    );
  },

  getSpendingPatterns: async (call, { caller, services, today }) => {
    const query = periodQuery(call, today, call.period ?? 'last-month');
    const insights = await services.insights.list(caller, query);
    const blocks: AssistantBlockDto[] =
      insights.items.length === 0
        ? [
            {
              kind: 'notice',
              tone: 'info',
              text: insights.insufficientHistory
                ? 'There is not enough history yet to compare spending reliably.'
                : 'Nothing stood out in this period by CalmCash’s rules.',
            },
          ]
        : [
            {
              kind: 'figures',
              title: 'What stood out',
              ...(insights.currency === undefined ? {} : { currency: insights.currency }),
              period: insights.period,
              figures: insights.items
                .slice(0, 6)
                .map((item) => ({ label: item.title, text: item.detail.slice(0, 118) })),
            },
          ];
    return outcome(
      blocks,
      [{ label: 'Open insights', target: { kind: 'insights' } }],
      'Patterns found by fixed rules in your recorded transactions.',
    );
  },

  getTopMerchants: async (call, { caller, services, today }) => {
    const query = periodQuery(call, today);
    const { period, currency, payees } = await services.insights.topPayees(caller, query, 6);
    const blocks: AssistantBlockDto[] =
      currency === undefined || payees.length === 0
        ? [
            {
              kind: 'notice',
              tone: 'info',
              text: 'No expenses with a merchant or description were recorded in this period.',
            },
          ]
        : [
            {
              kind: 'figures',
              title: 'Paid most often',
              currency,
              period,
              figures: payees.map((payee) => ({
                label: payee.label.slice(0, 80),
                amountMinor: payee.totalMinor.toString(),
                text: `${payee.count.toString()} payments`,
              })),
            },
          ];
    return outcome(
      blocks,
      [],
      'Merchants are grouped by the names and descriptions you recorded; they are not verified identities.',
    );
  },
};

/** Runs one planned call as the signed-in user; unknown tools never reach this point. */
export function runTool(call: ToolCallPlan, context: ToolContext): Promise<ToolOutcome> {
  return executors[call.tool](call, context);
}
