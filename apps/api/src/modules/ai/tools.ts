import {
  addDaysToIsoDate,
  AI_LIMITS,
  AI_TOOL_NAMES,
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
  days: z.number().int().min(1).max(90).nullish().describe('getUpcomingPayments only: days ahead.'),
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

// --- Tools ---------------------------------------------------------------------------------------

type ToolExecutor = (call: ToolCallPlan, context: ToolContext) => Promise<ToolOutcome>;

const executors: Readonly<Record<(typeof AI_TOOL_NAMES)[number], ToolExecutor>> = {
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
