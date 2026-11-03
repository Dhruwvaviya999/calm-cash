import {
  addDaysToIsoDate,
  INTELLIGENCE_RULES,
  lastOfMonth,
  monthOf,
  type BudgetRecommendationDto,
  type CurrencyCashFlowForecastDto,
  type CurrencyCode,
  type DataSufficiencyLevel,
  type FinancialRecommendationDto,
  type GoalProjectionDto,
  type IsoDateString,
  type RecommendationPriority,
  type SubscriptionDto,
} from '@calmcash/shared';

import { clip, formatBasisPoints, formatDate, formatMoney } from '../../lib/text-format';
import type { PendingOccurrence } from './cash-flow-forecast';
import { categorySeries, monthTotals, type History } from './history';
import type { RecommendationMark } from './intelligence.repository';
import { changeBp, sum } from './statistics';

// Recommendations: practical things to look at, each worked out from figures the other engines
// already calculated. Every item separates the observation (what the records show) from the
// suggestion (what the person could consider), names its source, and carries its evidence. Keys
// include the period they describe, so a dismissed recommendation stays dismissed until its
// subject changes (a new month, a new budget period) and is then looked at afresh. Nothing is
// recommended from insufficient history, no external benchmark is used, and nothing is promised.

export interface RecommendationInput {
  currency: CurrencyCode;
  today: IsoDateString;
  calculatedAt: string;
  sufficiency: DataSufficiencyLevel;
  forecast: CurrencyCashFlowForecastDto | undefined;
  budgets: readonly BudgetRecommendationDto[];
  goals: readonly GoalProjectionDto[];
  subscriptions: readonly SubscriptionDto[];
  /** Pending occurrences in the currency due in the next 30 days. */
  pending: readonly PendingOccurrence[];
  history: History;
  marks: ReadonlyMap<string, ReadonlySet<RecommendationMark>>;
}

const PRIORITY_ORDER: Readonly<Record<RecommendationPriority, number>> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Share of spending a category change must reach to be worth mentioning (basis points). */
const CATEGORY_CHANGE_MIN_SHARE_BP = 500n;

export function buildRecommendations(input: RecommendationInput): {
  items: FinancialRecommendationDto[];
  dismissedCount: number;
} {
  const { currency, today } = input;
  const money = (amount: bigint | string): string => formatMoney(amount, currency);
  const month = monthOf(today);
  const items: Omit<FinancialRecommendationDto, 'state' | 'createdAt'>[] = [];
  if (input.sufficiency === 'insufficient') {
    return { items: [], dismissedCount: 0 };
  }

  // --- Forecast shortfall ----------------------------------------------------------------------
  const forecast = input.forecast;
  if (forecast?.variableSpending.status === 'available') {
    const ending = BigInt(forecast.projected.endingPositionMinor);
    const income = BigInt(forecast.expectedIncomeMinor);
    const expenses = BigInt(forecast.expectedExpensesMinor);
    const to = addDaysToIsoDate(today, 30);
    if (ending < 0n || expenses > income) {
      items.push({
        key: `shortfall:${currency}:${month}`,
        type: 'forecast_shortfall',
        priority: ending < 0n ? 'high' : 'medium',
        title:
          ending < 0n
            ? 'Projected net position falls below zero in the next 30 days'
            : 'Expected spending is higher than expected income in the next 30 days',
        observation: `Over the next 30 days CalmCash expects ${money(expenses)} of spending (scheduled bills plus typical everyday spending) against ${money(income)} of scheduled income, ending at a projected net position of ${money(ending)}. This is an estimate, not a bank balance.`,
        suggestion:
          'Check that upcoming bills and income are scheduled correctly, and consider which planned or everyday spending could wait. A scenario can show the effect of a change before you make it.',
        metrics: [
          { label: 'Expected spending', amountMinor: forecast.expectedExpensesMinor },
          { label: 'Expected income', amountMinor: forecast.expectedIncomeMinor },
          { label: 'Projected net position', amountMinor: forecast.projected.endingPositionMinor },
        ],
        currency,
        period: { from: today, to },
        source: 'cash_flow_forecast',
        links: [
          { label: 'Try a scenario', target: { kind: 'scenarios' } },
          { label: 'Open bills and recurring payments', target: { kind: 'recurring' } },
        ],
        reevaluation: 'Recalculated on every visit; a new recommendation is made each month.',
      });
    }
  }

  // --- Budgets ---------------------------------------------------------------------------------
  for (const budget of input.budgets) {
    const existing = budget.existingBudget;
    const repeated = budget.flags.find((flag) => flag.code === 'repeated_overspending');
    if (existing !== undefined && repeated !== undefined) {
      const last = existing.recentPeriods.at(-1);
      const suggestion = budget.suggestions.find((entry) => entry.basis === 'historical_average');
      items.push({
        key: `overspend:${existing.budgetId}:${last?.from ?? month}`,
        type: 'budget_overspending',
        priority: existing.overCount >= 3 ? 'high' : 'medium',
        title: `${existing.name} has gone over its limit repeatedly`,
        observation: `${repeated.message} The limit is ${money(existing.limitMinor)}; your average month in ${budget.categoryName} was ${money(budget.history.averageMinor)}.`,
        suggestion:
          suggestion === undefined
            ? 'Consider whether the limit still fits, or which spending in this category could be reduced.'
            : `Consider whether the limit still fits: a limit near ${money(suggestion.limitMinor)} matches your average month (${suggestion.monthsWithin.toString()} of ${suggestion.monthsConsidered.toString()} months stayed within it). Or look at what in this category could be reduced.`,
        metrics: [
          { label: 'Current limit', amountMinor: existing.limitMinor },
          { label: 'Average month', amountMinor: budget.history.averageMinor },
          {
            label: 'Months over the limit',
            text: `${existing.overCount.toString()} of ${existing.recentPeriods.length.toString()}`,
          },
        ],
        currency,
        ...(last === undefined
          ? {}
          : { period: { from: existing.recentPeriods[0]?.from ?? last.from, to: last.to } }),
        source: 'budgets',
        links: [
          {
            label: `Open ${existing.name}`.slice(0, 80),
            target: { kind: 'budget', budgetId: existing.budgetId },
          },
        ],
        reevaluation: 'Looked at again after each completed budget month.',
        ...(suggestion === undefined ? {} : { budgetPrefill: budget.prefill }),
      });
    }
    if (
      existing === undefined &&
      budget.categoryId !== undefined &&
      (budget.sufficiency === 'moderate' || budget.sufficiency === 'strong')
    ) {
      const suggestion = budget.suggestions.find((entry) => entry.basis === 'historical_average');
      if (suggestion === undefined) continue;
      items.push({
        key: `budget:${currency}:${budget.categoryId}`,
        type: 'budget_suggestion',
        priority: 'low',
        title: `No budget yet for ${budget.categoryName}`,
        observation: `${budget.categoryName} averaged ${money(budget.history.averageMinor)} a month over ${budget.history.months.length.toString()} completed months (typical month ${money(budget.history.medianMinor)}).`,
        suggestion: `If you would like to keep an eye on it, a monthly budget near ${money(suggestion.limitMinor)} would be a starting point based on your history. It is only saved if you save the form.`,
        metrics: [
          { label: 'Average month', amountMinor: budget.history.averageMinor },
          { label: 'Suggested starting limit', amountMinor: suggestion.limitMinor },
        ],
        currency,
        source: 'spending_history',
        links: [{ label: 'Open budgets', target: { kind: 'budgets' } }],
        reevaluation: 'Shown while this category has no budget; dismiss it if you do not want one.',
        budgetPrefill: budget.prefill,
      });
    }
  }

  // --- Savings goals ---------------------------------------------------------------------------
  for (const goal of input.goals) {
    if (goal.state !== 'behind' && goal.state !== 'target_date_passed') continue;
    const required = goal.requiredMonthlyMinor;
    items.push({
      key: `goal:${goal.goalId}:${month}`,
      type: 'goal_behind',
      priority: 'medium',
      title:
        goal.state === 'behind'
          ? `${goal.name} is behind its target date at your recent pace`
          : `The target date of ${goal.name} has passed`,
      observation: `${money(goal.savedMinor)} of ${money(goal.targetMinor)} is set aside${goal.targetDate === undefined ? '' : `; the target date is ${formatDate(goal.targetDate)}`}.${goal.pace.status === 'available' ? ` Recent allocations average ${money(goal.pace.monthlyAverageMinor)} a month${goal.projectedCompletionDate === undefined ? '' : `, which would reach the target around ${formatDate(goal.projectedCompletionDate)}`}.` : ''}`,
      suggestion:
        required === undefined
          ? 'Consider setting a new target date, or how much you could set aside each month.'
          : `About ${money(required)} a month would reach the target on time. Moving the target date is another option.`,
      metrics: [
        { label: 'Remaining', amountMinor: goal.remainingMinor },
        ...(required === undefined ? [] : [{ label: 'Needed per month', amountMinor: required }]),
      ],
      currency,
      source: 'savings_goals',
      links: [{ label: 'Open savings goals', target: { kind: 'goals' } }],
      reevaluation: 'Looked at again each month and whenever the goal changes.',
    });
  }

  // --- Subscriptions ---------------------------------------------------------------------------
  const active = input.subscriptions
    .filter((item) => item.status === 'active' && item.schedule.currency === currency)
    .sort((a, b) => {
      const left = BigInt(a.nextTwelveMonths.amountMinor);
      const right = BigInt(b.nextTwelveMonths.amountMinor);
      return left === right ? 0 : left > right ? -1 : 1;
    });
  if (active.length >= 2) {
    const top = active.slice(0, 3);
    const total = sum(active.map((item) => BigInt(item.nextTwelveMonths.amountMinor)));
    items.push({
      key: `subs:${currency}:${month}`,
      type: 'subscription_review',
      priority: 'low',
      title: `Your ${active.length.toString()} subscriptions are estimated at ${money(total)} over 12 months`,
      observation: `The costliest are ${top.map((item) => `${item.schedule.name} (${money(item.nextTwelveMonths.amountMinor)})`).join(', ')}. CalmCash does not know how much you use them.`,
      suggestion:
        'Consider reviewing whether each one is still worth its cost to you. Cancelling is always your decision, in the subscriptions page.',
      metrics: top.map((item) => ({
        label: item.schedule.name.slice(0, 120),
        amountMinor: item.nextTwelveMonths.amountMinor,
        text: '12-month estimate',
      })),
      currency,
      source: 'subscriptions',
      links: [{ label: 'Open subscriptions', target: { kind: 'subscriptions' } }],
      reevaluation: 'A new review reminder each month.',
    });
  }

  // --- Payments clustered in one week ----------------------------------------------------------
  const expenses = input.pending
    .filter((item) => item.type === 'expense' && item.status !== 'overdue')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const [index, first] of expenses.entries()) {
    const end = addDaysToIsoDate(first.dueDate, 6);
    const week = expenses.slice(index).filter((item) => item.dueDate <= end);
    if (week.length < 3) continue;
    const weekTotal = sum(week.map((item) => item.amountMinor));
    items.push({
      key: `cluster:${currency}:${first.dueDate}`,
      type: 'payments_clustered',
      priority: 'low',
      title: `${week.length.toString()} scheduled payments fall within one week`,
      observation: `${week
        .map((item) => item.name)
        .slice(0, 5)
        .join(
          ', ',
        )} are due between ${formatDate(first.dueDate)} and ${formatDate(week.at(-1)?.dueDate ?? first.dueDate)}, ${money(weekTotal)} in total.`,
      suggestion:
        'Consider whether that week has enough money available, or whether any due date can be moved with the provider.',
      metrics: [
        { label: 'Payments', text: week.length.toString() },
        { label: 'Total', amountMinor: weekTotal.toString() },
      ],
      currency,
      period: { from: first.dueDate, to: end },
      source: 'recurring_schedules',
      links: [{ label: 'Open bills and recurring payments', target: { kind: 'recurring' } }],
      reevaluation: 'Shown until those payments are due.',
    });
    break;
  }

  // --- Category increases (three months against the three before) ------------------------------
  if (input.history.months.length >= 6) {
    const later = input.history.months.slice(-3);
    const earlier = input.history.months.slice(-6, -3);
    const laterTotal = sum(later.map((entry) => monthTotals(input.history, entry).expenseMinor));
    const found: Omit<FinancialRecommendationDto, 'state' | 'createdAt'>[] = [];
    for (const category of input.history.categories.values()) {
      if (category.categoryId === null) continue;
      const months = categorySeries(input.history, category);
      const pick = (subset: readonly string[]): bigint =>
        sum(
          months.filter((entry) => subset.includes(entry.month)).map((entry) => entry.amountMinor),
        );
      const active = (subset: readonly string[]): number =>
        months.filter((entry) => subset.includes(entry.month) && entry.count > 0).length;
      if (active(later) < 2 || active(earlier) < 2) continue;
      const now = pick(later);
      const before = pick(earlier);
      const change = changeBp(before, now);
      if (
        change === undefined ||
        change < INTELLIGENCE_RULES.trendChangeBp ||
        (now - before) * 10_000n < CATEGORY_CHANGE_MIN_SHARE_BP * laterTotal
      ) {
        continue;
      }
      const from = `${later[0] ?? month}-01`;
      const to = lastOfMonth(`${later.at(-1) ?? month}-01`);
      found.push({
        key: `rise:${currency}:${category.categoryId}:${month}`,
        type: 'category_increase',
        priority: change >= 5_000n ? 'medium' : 'low',
        title: `${category.name} spending rose by ${formatBasisPoints(change)}`,
        observation: `${money(now)} in the last three completed months, compared with ${money(before)} in the three before. This shows that recorded spending changed, not why.`,
        suggestion: `If that was not planned, consider looking at recent ${category.name} expenses, or try a scenario with a lower amount to see its effect.`,
        metrics: [
          { label: 'Last three months', amountMinor: now.toString() },
          { label: 'Three months before', amountMinor: before.toString() },
          { label: 'Change', text: `+${formatBasisPoints(change)}` },
        ],
        currency,
        period: { from, to },
        source: 'spending_history',
        links: [
          {
            label: `View ${category.name} expenses`.slice(0, 80),
            target: {
              kind: 'transactions',
              filters: { type: 'expense', categoryId: category.categoryId, currency, from, to },
            },
          },
          { label: 'Try a scenario', target: { kind: 'scenarios' } },
        ],
        reevaluation: 'Recalculated each month from the latest six completed months.',
      });
    }
    items.push(...found.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 3));
  }

  let dismissedCount = 0;
  const visible: FinancialRecommendationDto[] = [];
  for (const item of items) {
    const marks = input.marks.get(item.key);
    if (marks?.has('dismissed') === true) {
      dismissedCount += 1;
      continue;
    }
    visible.push({
      ...item,
      title: clip(item.title, 200),
      observation: clip(item.observation, 600),
      suggestion: clip(item.suggestion, 600),
      createdAt: input.calculatedAt,
      state: marks?.has('reviewed') === true ? 'reviewed' : 'new',
    });
  }
  visible.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      Number(a.state === 'reviewed') - Number(b.state === 'reviewed') ||
      a.title.localeCompare(b.title),
  );
  return { items: visible.slice(0, 30), dismissedCount };
}
