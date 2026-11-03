import {
  addDaysToIsoDate,
  addMonthsToIsoDate,
  calendarDateInTimeZone,
  completedMonths,
  currencyCodeSchema,
  daysBetween,
  firstOfMonth,
  lastOfMonth,
  MAX_PATTERN_RANGE_DAYS,
  MAX_UPCOMING_OCCURRENCES,
  monthOf,
  parseMinorUnits,
  patternRange,
  PATTERN_LIST_LIMIT,
  precedingRange,
  savingsRateBasisPoints,
  scenarioAdjustmentDtoSchema,
  scenarioHorizonSchema,
  SCENARIO_LIMITS,
  serializeMinorUnits,
  type ApiErrorDetail,
  type BudgetRecommendationsDto,
  type CalendarRange,
  type CashFlowForecastDto,
  type CashFlowForecastQuery,
  type CurrencyCashFlowForecastDto,
  type CurrencyCode,
  type FinancialHealthDto,
  type FinancialScenarioDto,
  type GoalProjectionDto,
  type GoalProjectionsDto,
  type IntelligenceOverviewDto,
  type IsoDateString,
  type RecommendationListDto,
  type RecommendationStateDto,
  type ScenarioAdjustmentDto,
  type ScenarioComparisonDto,
  type ScenarioDefinitionInput,
  type ScenarioListDto,
  type ScenarioListQuery,
  type ScenarioResultDto,
  type SpendingForecastDto,
  type SpendingForecastQuery,
  type SpendingPatternsDto,
  type SpendingPatternsQuery,
  type UpdateScenarioInput,
} from '@calmcash/shared';
import { z } from 'zod';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import type { AccountsService } from '../accounts/accounts.service';
import type { BudgetsService } from '../budgets/budgets.service';
import { chooseCurrency, orderCurrencies, toWindow } from '../dashboard/dashboard-metrics';
import type { DashboardRepository } from '../dashboard/dashboard.repository';
import type { GoalsService } from '../goals/goals.service';
import type { RecurringService } from '../recurring';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { recommendBudgets, type MonthlyBudgetRef } from './budget-recommendations';
import { forecastCashFlow, type PendingOccurrence } from './cash-flow-forecast';
import { healthIndicators, type AccountBreakdown } from './financial-health';
import { projectGoal, type GoalInput } from './goal-projections';
import { buildHistory, sufficiencyOf, UNCATEGORIZED_KEY, type History } from './history';
import type {
  IntelligenceRepository,
  MonthlyCategoryRow,
  RecommendationMark,
  ScenarioRecord,
} from './intelligence.repository';
import {
  BUDGET_METHODOLOGY,
  CASH_FLOW_METHODOLOGY,
  GOAL_METHODOLOGY,
  HEALTH_METHODOLOGY,
  SCENARIO_POLICY,
  SPENDING_FORECAST_METHODOLOGY,
} from './methodology';
import { buildRecommendations } from './recommendations';
import { simulateScenario, type ScenarioRefs } from './scenarios';
import { forecastCategories, type CategoryActual } from './spending-forecast';
import { buildPatterns } from './spending-patterns';

// Financial intelligence: forecasts, spending predictions, budget suggestions, goal projections,
// health indicators, recommendations, and scenarios. This service only gathers data — through the
// other modules' services (balances, budgets, schedules, goals) and this module's read-only
// aggregates — and hands it to the pure engines next to it. It never writes a transaction,
// balance, budget, schedule, or contribution; the only things it stores are saved scenario
// assumptions and the person's dismissed or reviewed recommendations.

export interface IntelligenceService {
  overview: (
    caller: Caller,
    query: { currency?: CurrencyCode },
  ) => Promise<IntelligenceOverviewDto>;
  cashFlowForecast: (caller: Caller, query: CashFlowForecastQuery) => Promise<CashFlowForecastDto>;
  spendingForecast: (caller: Caller, query: SpendingForecastQuery) => Promise<SpendingForecastDto>;
  spendingPatterns: (caller: Caller, query: SpendingPatternsQuery) => Promise<SpendingPatternsDto>;
  budgetRecommendations: (
    caller: Caller,
    query: { currency?: CurrencyCode },
  ) => Promise<BudgetRecommendationsDto>;
  goalProjections: (caller: Caller) => Promise<GoalProjectionsDto>;
  financialHealth: (
    caller: Caller,
    query: { currency?: CurrencyCode },
  ) => Promise<FinancialHealthDto>;
  recommendations: (
    caller: Caller,
    query: { currency?: CurrencyCode },
  ) => Promise<RecommendationListDto>;
  markRecommendation: (
    caller: Caller,
    key: string,
    mark: RecommendationMark,
  ) => Promise<RecommendationStateDto>;
  listScenarios: (caller: Caller, query: ScenarioListQuery) => Promise<ScenarioListDto>;
  getScenario: (caller: Caller, scenarioId: string) => Promise<FinancialScenarioDto>;
  createScenario: (caller: Caller, input: ScenarioDefinitionInput) => Promise<FinancialScenarioDto>;
  updateScenario: (
    caller: Caller,
    scenarioId: string,
    input: UpdateScenarioInput,
  ) => Promise<FinancialScenarioDto>;
  deleteScenario: (caller: Caller, scenarioId: string) => Promise<void>;
  runScenario: (caller: Caller, scenarioId: string) => Promise<ScenarioResultDto>;
  previewScenario: (caller: Caller, input: ScenarioDefinitionInput) => Promise<ScenarioResultDto>;
  compareScenarios: (
    caller: Caller,
    scenarioIds: readonly string[],
  ) => Promise<ScenarioComparisonDto>;
}

export interface IntelligenceServiceDependencies {
  repository: IntelligenceRepository;
  /** The dashboard's aggregate queries: one definition of cash flow everywhere. */
  dashboard: Pick<DashboardRepository, 'cashFlowTotals' | 'cashFlowTrend' | 'expensesByCategory'>;
  accounts: Pick<AccountsService, 'summary' | 'list'>;
  budgets: Pick<BudgetsService, 'list' | 'summary'>;
  recurring: Pick<RecurringService, 'collect' | 'list'>;
  subscriptions: Pick<SubscriptionsService, 'list' | 'summary'>;
  goals: Pick<GoalsService, 'list'>;
  now: () => Date;
}

const CASH_LIKE_TYPES = new Set(['cash', 'bank', 'savings', 'digital_wallet']);
const RECOMMENDATION_HORIZON = 30;

/** One promise per key for the life of a request scope (a request never repeats a query). */
function memoize<V>(): (key: string, load: () => Promise<V>) => Promise<V> {
  const cache = new Map<string, Promise<V>>();
  return (key, load) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const created = load();
    cache.set(key, created);
    return created;
  };
}

interface PendingList {
  items: PendingOccurrence[];
  truncated: boolean;
}

/** What one request has loaded or can load, each at most once. */
interface RequestScope {
  instant: Date;
  today: IsoDateString;
  currencies: () => Promise<CurrencyCode[]>;
  currencyFor: (requested: CurrencyCode | undefined) => Promise<CurrencyCode>;
  history: (currency: CurrencyCode) => Promise<{ history: History; rows: MonthlyCategoryRow[] }>;
  position: () => Promise<Map<CurrencyCode, { held: bigint; owed: bigint }>>;
  pendingFor: (currency: CurrencyCode, to: IsoDateString) => Promise<PendingList>;
  forecast: (
    currency: CurrencyCode,
    horizon: number,
    incomeBasis: CashFlowForecastQuery['income'],
  ) => Promise<CurrencyCashFlowForecastDto>;
  monthlyBudgets: (currency: CurrencyCode) => Promise<MonthlyBudgetRef[]>;
  goalInputs: () => Promise<GoalInput[]>;
  projections: () => Promise<GoalProjectionDto[]>;
}

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That scenario does not exist or is not yours.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

function asCurrency(value: string): CurrencyCode | undefined {
  const parsed = currencyCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const storedAdjustments = z.array(scenarioAdjustmentDtoSchema).max(SCENARIO_LIMITS.adjustments);

/** A stored scenario as its DTO; assumptions are validated on every read. */
function toScenarioDto(record: ScenarioRecord): FinancialScenarioDto {
  const adjustments = storedAdjustments.safeParse(record.assumptions);
  return {
    id: record.id,
    name: record.name,
    currency: currencyCodeSchema.parse(record.currency),
    horizonDays: scenarioHorizonSchema.parse(record.horizonDays),
    adjustments: adjustments.success ? adjustments.data : [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createIntelligenceService({
  repository,
  dashboard,
  accounts,
  budgets,
  recurring,
  subscriptions,
  goals,
  now,
}: IntelligenceServiceDependencies): IntelligenceService {
  /**
   * Everything one request reads, loaded at most once: a request that needs the forecast, the
   * budgets, and the goals (recommendations, health) never repeats a query.
   */
  const scope = (caller: Caller): RequestScope => {
    const instant = now();
    const today = calendarDateInTimeZone(instant, caller.timeZone);
    const cached = {
      currencies: memoize<CurrencyCode[]>(),
      history: memoize<{ history: History; rows: MonthlyCategoryRow[] }>(),
      position: memoize<Map<CurrencyCode, { held: bigint; owed: bigint }>>(),
      pending: memoize<PendingList>(),
      budgets: memoize<MonthlyBudgetRef[]>(),
      goals: memoize<GoalInput[]>(),
    };

    const currencies = (): Promise<CurrencyCode[]> =>
      cached.currencies('all', async () => {
        const stored = (await repository.currencies(caller.userId)).flatMap((code) => {
          const currency = asCurrency(code);
          return currency === undefined ? [] : [currency];
        });
        return orderCurrencies(stored, caller.preferredCurrency);
      });

    const currencyFor = async (requested: CurrencyCode | undefined): Promise<CurrencyCode> =>
      chooseCurrency(requested, await currencies(), caller.preferredCurrency);

    const historyStart = completedMonths(today, 6)[0]?.from ?? firstOfMonth(today);

    /** Rows from six completed months ago through today, and the history built from them. */
    const history = (
      currency: CurrencyCode,
    ): Promise<{ history: History; rows: MonthlyCategoryRow[] }> =>
      cached.history(currency, async () => {
        const window = toWindow({ from: historyStart, to: today }, caller.timeZone);
        const [rows, first] = await Promise.all([
          repository.monthlyTotals(caller.userId, currency, window, caller.timeZone),
          repository.firstActivity(caller.userId, currency),
        ]);
        const firstDate =
          first === null ? undefined : calendarDateInTimeZone(first, caller.timeZone);
        return { history: buildHistory(rows, today, firstDate), rows };
      });

    const position = (): Promise<Map<CurrencyCode, { held: bigint; owed: bigint }>> =>
      cached.position('all', async () => {
        const summary = await accounts.summary(caller);
        return new Map(
          summary.currencies.map((entry) => [
            entry.currency,
            {
              held: parseMinorUnits(entry.assetsMinor),
              owed: parseMinorUnits(entry.liabilitiesMinor),
            },
          ]),
        );
      });

    /** Pending occurrences (any currency) due up to `to`, overdue ones included. */
    const pending = (to: IsoDateString): Promise<PendingList> =>
      cached.pending(to, async () => {
        const upcoming = await recurring.collect(caller, {
          from: today,
          to,
          limit: MAX_UPCOMING_OCCURRENCES,
        });
        const items = upcoming.items.flatMap(({ occurrence, schedule }): PendingOccurrence[] => {
          const status = occurrence.status;
          if (status !== 'upcoming' && status !== 'due' && status !== 'overdue') return [];
          return [
            {
              scheduleId: schedule.id,
              currency: occurrence.currency,
              name: schedule.name,
              type: schedule.type,
              isSubscription: schedule.isSubscription,
              categoryId: schedule.categoryId,
              scheduledDate: occurrence.scheduledDate,
              dueDate: occurrence.dueDate,
              status,
              postponed: occurrence.postponed,
              amountMinor: parseMinorUnits(occurrence.amountMinor),
            },
          ];
        });
        return { items, truncated: upcoming.truncated };
      });

    const pendingFor = async (currency: CurrencyCode, to: IsoDateString): Promise<PendingList> => {
      const all = await pending(to);
      return {
        items: all.items.filter((item) => item.currency === currency),
        truncated: all.truncated,
      };
    };

    const forecast = async (
      currency: CurrencyCode,
      horizon: number,
      incomeBasis: CashFlowForecastQuery['income'],
    ): Promise<CurrencyCashFlowForecastDto> => {
      const to = addDaysToIsoDate(today, horizon);
      const [{ history: past, rows }, positions, due] = await Promise.all([
        history(currency),
        position(),
        pendingFor(currency, to),
      ]);
      const month = monthOf(today);
      const current = rows.filter((row) => row.month === month);
      const sumOf = (type: 'income' | 'expense'): bigint =>
        current
          .filter((row) => row.type === type)
          .reduce((total, row) => total + row.totalMinor, 0n);
      const held = positions.get(currency);
      return forecastCashFlow({
        currency,
        today,
        horizonDays: horizon,
        incomeBasis,
        heldMinor: held?.held ?? 0n,
        owedMinor: held?.owed ?? 0n,
        monthToDate: {
          from: firstOfMonth(today),
          to: today,
          incomeMinor: sumOf('income'),
          expenseMinor: sumOf('expense'),
        },
        pending: due.items,
        pendingTruncated: due.truncated,
        history: past,
      });
    };

    const monthlyBudgets = (currency: CurrencyCode): Promise<MonthlyBudgetRef[]> =>
      cached.budgets(currency, async () => {
        const dates = completedMonths(today, 4).map((range) => range.to);
        const [current, ...past] = await Promise.all(
          [today, ...dates].map((date) =>
            budgets.list(caller, { status: 'active', currency, period: 'monthly', date }),
          ),
        );
        return (current?.budgets ?? [])
          .filter((item) => item.progress.timing === 'current')
          .map((item) => ({
            budgetId: item.budget.id,
            name: item.budget.name,
            categoryId: item.budget.categoryId ?? null,
            limitMinor: parseMinorUnits(item.budget.limitMinor),
            recent: past.flatMap((list) => {
              const entry = list.budgets.find(
                (candidate) => candidate.budget.id === item.budget.id,
              );
              if (entry?.progress.timing !== 'current') return [];
              return [
                {
                  from: entry.progress.from,
                  to: entry.progress.to,
                  spentMinor: parseMinorUnits(entry.progress.spentMinor),
                  limitMinor: parseMinorUnits(entry.progress.limitMinor),
                  status: entry.progress.status,
                },
              ];
            }),
          }));
      });

    const goalInputs = (): Promise<GoalInput[]> =>
      cached.goals('all', async () => {
        const list = await goals.list(caller, { status: 'current' });
        const ids = list.goals.map((item) => item.goal.id);
        const contributions = await repository.goalMonths(caller.userId, ids, historyStart);
        return list.goals.flatMap((item): GoalInput[] => {
          const currency = asCurrency(item.goal.currency);
          if (currency === undefined) return [];
          const monthly = new Map(
            contributions.months
              .filter((row) => row.goalId === item.goal.id)
              .map((row) => [row.month, { amountMinor: row.totalMinor, count: row.count }]),
          );
          return [
            {
              goalId: item.goal.id,
              name: item.goal.name,
              currency,
              status: item.goal.status,
              targetMinor: parseMinorUnits(item.goal.targetMinor),
              savedMinor: parseMinorUnits(item.progress.savedMinor),
              percent: item.progress.percent,
              contributionCount: item.progress.contributionCount,
              targetDate: item.goal.targetDate,
              firstContribution: contributions.first.get(item.goal.id),
              monthly,
            },
          ];
        });
      });

    const projections = async (): Promise<GoalProjectionDto[]> =>
      (await goalInputs()).map((goal) => projectGoal(goal, today));

    return {
      instant,
      today,
      currencies,
      currencyFor,
      history,
      position,
      pendingFor,
      forecast,
      monthlyBudgets,
      goalInputs,
      projections,
    };
  };

  /** Rejects identifiers that are not the caller's (a different person's ID looks missing). */
  const checkReferences = async (
    caller: Caller,
    adjustments: readonly ScenarioAdjustmentDto[],
  ): Promise<void> => {
    const categoryIds = adjustments.flatMap((item) =>
      item.kind === 'category_spending' ? [item.categoryId] : [],
    );
    const scheduleIds = adjustments.flatMap((item) =>
      item.kind === 'cancel_schedule' || item.kind === 'change_schedule_amount'
        ? [item.scheduleId]
        : [],
    );
    const goalIds = adjustments.flatMap((item) =>
      item.kind === 'goal_contribution' || item.kind === 'goal_target_date' ? [item.goalId] : [],
    );
    const [categories, schedules, goalList] = await Promise.all([
      repository.categories(caller.userId, categoryIds),
      scheduleIds.length === 0 ? undefined : recurring.list(caller, { status: 'all' }),
      goalIds.length === 0 ? undefined : goals.list(caller, { status: 'all' }),
    ]);
    const known = new Set([
      ...categories.map((category) => category.id),
      ...(schedules?.schedules.map((item) => item.schedule.id) ?? []),
      ...(goalList?.goals.map((item) => item.goal.id) ?? []),
    ]);
    const details: ApiErrorDetail[] = [];
    adjustments.forEach((item, index) => {
      const id =
        item.kind === 'category_spending'
          ? item.categoryId
          : item.kind === 'cancel_schedule' || item.kind === 'change_schedule_amount'
            ? item.scheduleId
            : item.kind === 'goal_contribution' || item.kind === 'goal_target_date'
              ? item.goalId
              : undefined;
      if (id !== undefined && !known.has(id)) {
        details.push({
          path: `body.adjustments.${index.toString()}`,
          message: 'Choose one of your own categories, schedules, or goals.',
        });
      }
    });
    if (details.length > 0) throw invalid(details);
  };

  const simulate = async (
    caller: Caller,
    definition: ScenarioDefinitionInput,
    scenarioId?: string,
  ): Promise<ScenarioResultDto> => {
    const context = scope(caller);
    const { currency, horizonDays } = definition;
    const to = addDaysToIsoDate(context.today, horizonDays);
    const categoryIds = definition.adjustments.flatMap((item) =>
      item.kind === 'category_spending' ? [item.categoryId] : [],
    );
    const [{ history: past }, positions, due, categories, schedules, goalInputs, current] =
      await Promise.all([
        context.history(currency),
        context.position(),
        context.pendingFor(currency, to),
        repository.categories(caller.userId, categoryIds),
        recurring.list(caller, { status: 'current' }),
        context.goalInputs(),
        budgets.list(caller, {
          status: 'active',
          currency,
          period: 'monthly',
          date: context.today,
        }),
      ]);
    const held = positions.get(currency);
    const refs: ScenarioRefs = {
      categories: new Map(categories.map((category) => [category.id, category])),
      schedules: new Map(
        schedules.schedules.map((item) => [
          item.schedule.id,
          {
            name: item.schedule.name,
            type: item.schedule.type,
            currency: item.schedule.currency,
            active: item.schedule.status === 'active',
          },
        ]),
      ),
      goals: new Map(goalInputs.map((goal) => [goal.goalId, goal])),
      budgets: current.budgets.flatMap((item) =>
        item.budget.categoryId === undefined || item.progress.timing !== 'current'
          ? []
          : [
              {
                budgetId: item.budget.id,
                name: item.budget.name,
                categoryId: item.budget.categoryId,
                limitMinor: parseMinorUnits(item.budget.limitMinor),
              },
            ],
      ),
    };
    const result = simulateScenario(
      definition,
      {
        currency,
        today: context.today,
        heldMinor: held?.held ?? 0n,
        owedMinor: held?.owed ?? 0n,
        pending: due.items,
        history: past,
      },
      refs,
    );
    return {
      ...(scenarioId === undefined ? {} : { scenarioId }),
      ...result,
      calculatedAt: context.instant.toISOString(),
      recalculationPolicy: SCENARIO_POLICY,
    };
  };

  const ownScenario = async (caller: Caller, scenarioId: string): Promise<FinancialScenarioDto> => {
    const record = await repository.findScenario(caller.userId, scenarioId);
    if (record === null) throw notFound();
    return toScenarioDto(record);
  };

  const budgetRecommendations: IntelligenceService['budgetRecommendations'] = async (
    caller,
    query,
  ) => {
    const context = scope(caller);
    const currency = await context.currencyFor(query.currency);
    const [{ history: past }, monthly, currencies] = await Promise.all([
      context.history(currency),
      context.monthlyBudgets(currency),
      context.currencies(),
    ]);
    const months = completedMonths(context.today, 6);
    return {
      currency,
      currencies,
      history: {
        from:
          past.months[0] === undefined
            ? (months[0]?.from ?? context.today)
            : `${past.months[0]}-01`,
        to: months.at(-1)?.to ?? context.today,
      },
      calculatedAt: context.instant.toISOString(),
      sufficiency: sufficiencyOf(past),
      items: recommendBudgets(past, monthly, currency).slice(0, 100),
      methodology: BUDGET_METHODOLOGY,
    };
  };

  return {
    overview: async (caller, query) => {
      const context = scope(caller);
      const currency = await context.currencyFor(query.currency);
      const thisMonth: CalendarRange = { from: firstOfMonth(context.today), to: context.today };
      const lastFrom = addMonthsToIsoDate(thisMonth.from, -1);
      const lastMonth: CalendarRange = { from: lastFrom, to: lastOfMonth(lastFrom) };
      const [[current, previous], positions, { history: past }, currencies] = await Promise.all([
        dashboard.cashFlowTotals(caller.userId, currency, [
          toWindow(thisMonth, caller.timeZone),
          toWindow(lastMonth, caller.timeZone),
        ]),
        context.position(),
        context.history(currency),
        context.currencies(),
      ]);
      const income = current?.incomeMinor ?? 0n;
      const expense = current?.expenseMinor ?? 0n;
      const rate = savingsRateBasisPoints(income, expense);
      const held = positions.get(currency);
      return {
        currency,
        currencies,
        today: context.today,
        calculatedAt: context.instant.toISOString(),
        thisMonth,
        incomeMinor: serializeMinorUnits(income),
        expenseMinor: serializeMinorUnits(expense),
        netMinor: serializeMinorUnits(income - expense),
        savingsRate:
          rate === undefined
            ? { status: 'unavailable', reason: 'no_income' }
            : { status: 'available', basisPoints: rate.toString() },
        heldMinor: serializeMinorUnits(held?.held ?? 0n),
        owedMinor: serializeMinorUnits(held?.owed ?? 0n),
        lastMonth: {
          ...lastMonth,
          incomeMinor: serializeMinorUnits(previous?.incomeMinor ?? 0n),
          expenseMinor: serializeMinorUnits(previous?.expenseMinor ?? 0n),
        },
        sufficiency: sufficiencyOf(past),
      };
    },

    cashFlowForecast: async (caller, query) => {
      const context = scope(caller);
      const available = await context.currencies();
      const targets =
        query.currency !== undefined
          ? [query.currency]
          : available.length === 0
            ? [caller.preferredCurrency]
            : available.slice(0, 10);
      const forecasts = await Promise.all(
        targets.map((currency) => context.forecast(currency, query.horizon, query.income)),
      );
      return {
        today: context.today,
        from: context.today,
        to: addDaysToIsoDate(context.today, query.horizon),
        horizonDays: query.horizon,
        timeZone: caller.timeZone,
        incomeBasis: query.income,
        calculatedAt: context.instant.toISOString(),
        availableCurrencies: available,
        forecasts,
        methodology: CASH_FLOW_METHODOLOGY,
        warnings:
          available.length > 1
            ? [
                {
                  code: 'multiple_currencies',
                  message:
                    'You use more than one currency. Each is forecast on its own; amounts are never added together or converted.',
                },
              ]
            : [],
      };
    },

    spendingForecast: async (caller, query) => {
      const context = scope(caller);
      const currency = await context.currencyFor(query.currency);
      const thisMonth = firstOfMonth(context.today);
      const nextStart = addMonthsToIsoDate(thisMonth, 1);
      const range: CalendarRange =
        query.period === 'this-month'
          ? { from: thisMonth, to: lastOfMonth(thisMonth) }
          : { from: nextStart, to: lastOfMonth(nextStart) };
      const [{ history: past, rows }, due, currencies, list] = await Promise.all([
        context.history(currency),
        context.pendingFor(currency, range.to),
        context.currencies(),
        budgets.list(caller, { status: 'active', currency, period: 'monthly', date: range.from }),
      ]);
      const month = monthOf(context.today);
      const actuals: CategoryActual[] = [];
      if (query.period === 'this-month') {
        for (const row of rows) {
          if (row.month !== month || row.type !== 'expense') continue;
          const key = row.categoryId ?? UNCATEGORIZED_KEY;
          const existing = actuals.find((entry) => entry.key === key);
          if (existing === undefined) {
            actuals.push({
              key,
              categoryId: row.categoryId,
              name: row.name ?? 'Uncategorised',
              archived: row.archived,
              amountMinor: row.totalMinor,
            });
          } else {
            existing.amountMinor += row.totalMinor;
          }
        }
      }
      const budgetsByCategory = new Map(
        list.budgets.flatMap((item) =>
          item.budget.categoryId === undefined
            ? []
            : [
                [
                  item.budget.categoryId,
                  {
                    budgetId: item.budget.id,
                    name: item.budget.name,
                    limitMinor: parseMinorUnits(item.budget.limitMinor),
                  },
                ],
              ],
        ),
      );
      const daysInPeriod = daysBetween(range.from, range.to) + 1;
      const daysElapsed =
        query.period === 'this-month' ? daysBetween(range.from, context.today) + 1 : 0;
      const categories = forecastCategories(
        past,
        actuals,
        { daysElapsed, daysInPeriod },
        budgetsByCategory,
      );
      let actual = 0n;
      let remaining = 0n;
      for (const item of categories) {
        actual += BigInt(item.actualToDateMinor);
        if (item.estimate.status === 'available')
          remaining += BigInt(item.estimate.expectedRemainingMinor);
      }
      const scheduled = due.items.filter(
        (item) =>
          item.type === 'expense' &&
          item.status !== 'overdue' &&
          item.dueDate >= (query.period === 'this-month' ? context.today : range.from) &&
          item.dueDate <= range.to,
      );
      return {
        period: query.period,
        from: range.from,
        to: range.to,
        today: context.today,
        daysElapsed,
        daysInPeriod,
        currency,
        currencies,
        calculatedAt: context.instant.toISOString(),
        sufficiency: sufficiencyOf(past),
        totals: {
          actualToDateMinor: serializeMinorUnits(actual),
          expectedRemainingMinor: serializeMinorUnits(remaining),
          estimatedPeriodEndMinor: serializeMinorUnits(actual + remaining),
        },
        scheduledRemaining: {
          amountMinor: serializeMinorUnits(
            scheduled.reduce((total, item) => total + item.amountMinor, 0n),
          ),
          count: scheduled.length,
          subscriptionMinor: serializeMinorUnits(
            scheduled
              .filter((item) => item.isSubscription)
              .reduce((total, item) => total + item.amountMinor, 0n),
          ),
        },
        categories: categories.slice(0, 200),
        methodology: SPENDING_FORECAST_METHODOLOGY,
      };
    },

    spendingPatterns: async (caller, query) => {
      const context = scope(caller);
      const currency = await context.currencyFor(query.currency);
      let range: CalendarRange;
      if (query.period === 'custom') {
        if (query.from === undefined || query.to === undefined) {
          throw invalid([
            { path: 'query.from', message: 'A custom period needs a start and an end date.' },
          ]);
        }
        if (query.to > context.today) {
          throw invalid([{ path: 'query.to', message: 'The end date cannot be in the future.' }]);
        }
        if (query.from < '1900-01-01') {
          throw invalid([{ path: 'query.from', message: 'Choose a date after 1900.' }]);
        }
        if (daysBetween(query.from, query.to) + 1 > MAX_PATTERN_RANGE_DAYS) {
          throw invalid([{ path: 'query.to', message: 'Choose a range of at most three years.' }]);
        }
        range = { from: query.from, to: query.to };
      } else {
        range = patternRange(query.period, context.today);
      }
      const comparedTo = precedingRange(range);
      const window = toWindow(range, caller.timeZone);
      const previous = toWindow(comparedTo, caller.timeZone);
      const userId = caller.userId;
      const [
        [totals],
        monthly,
        categories,
        previousCategories,
        categoryMonths,
        distribution,
        largest,
        weekdays,
        merchants,
        { history: past },
        currencies,
      ] = await Promise.all([
        dashboard.cashFlowTotals(userId, currency, [window]),
        dashboard.cashFlowTrend(userId, currency, window, 'month', caller.timeZone),
        dashboard.expensesByCategory(userId, currency, window),
        dashboard.expensesByCategory(userId, currency, previous),
        repository.monthlyTotals(userId, currency, window, caller.timeZone),
        repository.distribution(userId, currency, window),
        repository.largestExpenses(userId, currency, window),
        repository.weekdayTotals(userId, currency, window, caller.timeZone),
        repository.merchants(
          userId,
          currency,
          window,
          previous,
          caller.timeZone,
          PATTERN_LIST_LIMIT,
        ),
        context.history(currency),
        context.currencies(),
      ]);
      return buildPatterns({
        period: query.period,
        range,
        comparedTo,
        currency,
        currencies,
        calculatedAt: context.instant.toISOString(),
        timeZone: caller.timeZone,
        sufficiency: sufficiencyOf(past),
        totals: totals ?? { incomeMinor: 0n, expenseMinor: 0n, incomeCount: 0, expenseCount: 0 },
        monthly,
        categories,
        previousCategories,
        categoryMonths,
        distribution,
        largest,
        weekdays,
        merchants,
      });
    },

    budgetRecommendations,

    goalProjections: async (caller) => {
      const context = scope(caller);
      return {
        today: context.today,
        calculatedAt: context.instant.toISOString(),
        goals: (await context.projections()).slice(0, 100),
        methodology: GOAL_METHODOLOGY,
      };
    },

    financialHealth: async (caller, query) => {
      const context = scope(caller);
      const currency = await context.currencyFor(query.currency);
      const in30 = addDaysToIsoDate(context.today, 30);
      const [
        { history: past },
        summary,
        monthly,
        due,
        subscriptionSummary,
        projections,
        accountList,
        currencies,
      ] = await Promise.all([
        context.history(currency),
        budgets.summary(caller, { currency, date: context.today }),
        context.monthlyBudgets(currency),
        context.pendingFor(currency, in30),
        subscriptions.summary(caller),
        context.projections(),
        accounts.list(caller, { status: 'active' }),
        context.currencies(),
      ]);
      const breakdown: AccountBreakdown = {
        cashLikeMinor: 0n,
        otherAssetsMinor: 0n,
        owedMinor: 0n,
        cashLikeAccounts: 0,
        otherAssetAccounts: 0,
        liabilityAccounts: 0,
      };
      for (const { account, balance } of accountList.accounts) {
        if (account.currency !== currency) continue;
        if (account.classification === 'liability') {
          breakdown.owedMinor += parseMinorUnits(balance.amountOwedMinor ?? '0');
          breakdown.liabilityAccounts += 1;
        } else if (CASH_LIKE_TYPES.has(account.type)) {
          breakdown.cashLikeMinor += parseMinorUnits(balance.currentBalanceMinor);
          breakdown.cashLikeAccounts += 1;
        } else {
          breakdown.otherAssetsMinor += parseMinorUnits(balance.currentBalanceMinor);
          breakdown.otherAssetAccounts += 1;
        }
      }
      const repeated = recommendBudgets(past, monthly, currency)
        .filter((item) => item.flags.some((flag) => flag.code === 'repeated_overspending'))
        .map((item) => item.existingBudget?.name ?? item.categoryName);
      const expenses = due.items.filter((item) => item.type === 'expense');
      return {
        currency,
        currencies,
        today: context.today,
        calculatedAt: context.instant.toISOString(),
        sufficiency: sufficiencyOf(past),
        indicators: healthIndicators({
          currency,
          today: context.today,
          history: past,
          budgetSummary: summary.currency === currency ? summary : undefined,
          repeatedOverspending: repeated,
          next30Expenses: {
            amountMinor: expenses.reduce((total, item) => total + item.amountMinor, 0n),
            count: expenses.length,
          },
          subscriptions: subscriptionSummary.currencies.find(
            (entry) => entry.currency === currency,
          ),
          goals: projections.filter((goal) => goal.currency === currency),
          accounts: breakdown,
        }),
        methodology: HEALTH_METHODOLOGY,
      };
    },

    recommendations: async (caller, query) => {
      const context = scope(caller);
      const currency = await context.currencyFor(query.currency);
      const in30 = addDaysToIsoDate(context.today, RECOMMENDATION_HORIZON);
      const [
        { history: past },
        forecast,
        monthly,
        projections,
        subscriptionList,
        due,
        marks,
        currencies,
      ] = await Promise.all([
        context.history(currency),
        context.forecast(currency, RECOMMENDATION_HORIZON, 'scheduled'),
        context.monthlyBudgets(currency),
        context.projections(),
        subscriptions.list(caller, { status: 'current' }),
        context.pendingFor(currency, in30),
        repository.recommendationMarks(caller.userId),
        context.currencies(),
      ]);
      const sufficiency = sufficiencyOf(past);
      const calculatedAt = context.instant.toISOString();
      const { items, dismissedCount } = buildRecommendations({
        currency,
        today: context.today,
        calculatedAt,
        sufficiency: sufficiency.level,
        forecast,
        budgets: recommendBudgets(past, monthly, currency),
        goals: projections.filter((goal) => goal.currency === currency),
        subscriptions: subscriptionList.subscriptions,
        pending: due.items,
        history: past,
        marks,
      });
      return { currency, currencies, calculatedAt, sufficiency, items, dismissedCount };
    },

    markRecommendation: async (caller, key, mark) => {
      await repository.markRecommendation(caller.userId, key, mark);
      return { key, state: mark };
    },

    listScenarios: async (caller, { page }) => {
      const pageSize = SCENARIO_LIMITS.pageSize;
      const { items, total } = await repository.listScenarios(caller.userId, page, pageSize);
      return {
        items: items.map(toScenarioDto),
        pagination: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) },
      };
    },

    getScenario: ownScenario,

    createScenario: async (caller, input) => {
      await checkReferences(caller, input.adjustments);
      const record = await repository.createScenario(caller.userId, {
        name: input.name,
        currency: input.currency,
        horizonDays: input.horizonDays,
        assumptions: input.adjustments,
      });
      if (record === null) {
        throw new AppError(
          409,
          'CONFLICT',
          `You can keep up to ${SCENARIO_LIMITS.scenarios.toString()} scenarios. Delete one to save another.`,
        );
      }
      return toScenarioDto(record);
    },

    updateScenario: async (caller, scenarioId, input) => {
      await ownScenario(caller, scenarioId);
      if (input.adjustments !== undefined) await checkReferences(caller, input.adjustments);
      const record = await repository.updateScenario(caller.userId, scenarioId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
        ...(input.horizonDays === undefined ? {} : { horizonDays: input.horizonDays }),
        ...(input.adjustments === undefined ? {} : { assumptions: input.adjustments }),
      });
      if (record === null) throw notFound();
      return toScenarioDto(record);
    },

    deleteScenario: async (caller, scenarioId) => {
      if (!(await repository.deleteScenario(caller.userId, scenarioId))) throw notFound();
    },

    runScenario: async (caller, scenarioId) => {
      const scenario = await ownScenario(caller, scenarioId);
      return simulate(caller, scenario, scenario.id);
    },

    previewScenario: async (caller, input) => {
      await checkReferences(caller, input.adjustments);
      return simulate(caller, input);
    },

    compareScenarios: async (caller, scenarioIds) => {
      const records = await repository.findScenarios(caller.userId, scenarioIds);
      if (records.length !== scenarioIds.length) throw notFound();
      const byId = new Map(records.map((record) => [record.id, toScenarioDto(record)]));
      const results: ScenarioResultDto[] = [];
      for (const id of scenarioIds) {
        const scenario = byId.get(id);
        if (scenario === undefined) throw notFound();
        results.push(await simulate(caller, scenario, scenario.id));
      }
      return { results };
    },
  };
}
