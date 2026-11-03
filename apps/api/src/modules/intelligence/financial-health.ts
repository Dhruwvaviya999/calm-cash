import {
  addDaysToIsoDate,
  lastOfMonth,
  savingsRateBasisPoints,
  serializeMinorUnits,
  shareBasisPoints,
  type BudgetSummaryDto,
  type CurrencyCode,
  type FigureDto,
  type GoalProjectionDto,
  type HealthIndicatorDto,
  type IsoDateString,
  type SubscriptionCurrencySummaryDto,
} from '@calmcash/shared';

import { formatBasisPoints } from '../../lib/text-format';
import { isIrregular } from './cash-flow-forecast';
import { levelForMonths, monthTotals, series, type History } from './history';
import { highest, lowest, median, tenthsText } from './statistics';

// Explainable financial-health indicators. There is deliberately no overall score: each indicator
// is one measured fact with its definition, period, currency, and the values it is calculated
// from. None of them is a judgement about the person's life, and money held is never called an
// emergency fund (CalmCash does not know what it is set aside for).

export interface AccountBreakdown {
  /** Cash, bank, savings, and wallet accounts. */
  cashLikeMinor: bigint;
  /** Investment and other asset accounts (values as entered, not market prices). */
  otherAssetsMinor: bigint;
  owedMinor: bigint;
  cashLikeAccounts: number;
  otherAssetAccounts: number;
  liabilityAccounts: number;
}

export interface HealthInput {
  currency: CurrencyCode;
  today: IsoDateString;
  history: History;
  budgetSummary: BudgetSummaryDto | undefined;
  /** Names of budgets over their limit in at least two of the last four completed months. */
  repeatedOverspending: readonly string[];
  /** Scheduled expenses due in the next 30 days (overdue ones included). */
  next30Expenses: { amountMinor: bigint; count: number };
  subscriptions: SubscriptionCurrencySummaryDto | undefined;
  goals: readonly GoalProjectionDto[];
  accounts: AccountBreakdown;
}

const RECENT_MONTHS = 3;

export function healthIndicators(input: HealthInput): HealthIndicatorDto[] {
  const { currency, history } = input;
  const figure = (label: string, amount: bigint, text?: string): FigureDto => ({
    label,
    amountMinor: serializeMinorUnits(amount),
    ...(text === undefined ? {} : { text }),
  });
  const textFigure = (label: string, text: string): FigureDto => ({ label, text });
  const indicators: HealthIndicatorDto[] = [];

  // --- Cash flow -------------------------------------------------------------------------------
  const recent = history.months.slice(-RECENT_MONTHS);
  const recentPeriod =
    recent.length === 0
      ? undefined
      : { from: `${recent[0] ?? ''}-01`, to: lastOfMonth(`${recent.at(-1) ?? ''}-01`) };
  const recentTotals = recent.map((month) => monthTotals(history, month));
  const income = recentTotals.reduce((total, month) => total + month.incomeMinor, 0n);
  const spending = recentTotals.reduce((total, month) => total + month.expenseMinor, 0n);
  const rate = savingsRateBasisPoints(income, spending);
  const level = levelForMonths(recent.length);
  if (recentPeriod === undefined) {
    indicators.push({
      key: `cash-flow:savings-rate:${currency}`,
      group: 'cash_flow',
      title: 'Income versus spending',
      definition:
        'Income and spending of the last three completed months, and the savings rate: (income − spending) ÷ income.',
      currency,
      status: 'unavailable',
      figures: [],
      sufficiency: 'insufficient',
      unavailableReason: 'No completed month of recorded history yet.',
    });
  } else {
    indicators.push({
      key: `cash-flow:savings-rate:${currency}`,
      group: 'cash_flow',
      title: 'Income versus spending',
      definition: `Income and spending of the last ${recent.length.toString()} completed months, and the savings rate: (income − spending) ÷ income. Transfers and balance corrections are not income or spending.`,
      currency,
      period: recentPeriod,
      status: 'available',
      headline:
        rate === undefined
          ? textFigure('Savings rate', 'not available (no income)')
          : textFigure('Savings rate', formatBasisPoints(rate)),
      figures: [
        figure('Income', income),
        figure('Spending', spending),
        figure('Net cash flow', income - spending),
      ],
      sufficiency: level,
      link: {
        label: 'Open the dashboard',
        target: { kind: 'dashboard', period: 'last-3-months', currency },
      },
    });
  }

  const nets = series(history, (month) => month.incomeMinor - month.expenseMinor);
  const positive = nets.filter((value) => value > 0n).length;
  indicators.push({
    key: `cash-flow:consistency:${currency}`,
    group: 'cash_flow',
    title: 'Month-to-month consistency',
    definition:
      'How many completed months ended with more income than spending, and the range of monthly net cash flow.',
    currency,
    ...(history.months.length === 0
      ? {}
      : {
          period: {
            from: `${history.months[0] ?? ''}-01`,
            to: lastOfMonth(`${history.months.at(-1) ?? ''}-01`),
          },
        }),
    status: nets.length >= 2 ? 'available' : 'unavailable',
    ...(nets.length >= 2
      ? {
          headline: textFigure(
            'Months with positive net',
            `${positive.toString()} of ${nets.length.toString()}`,
          ),
        }
      : {}),
    figures:
      nets.length >= 2
        ? [figure('Lowest month', lowest(nets)), figure('Highest month', highest(nets))]
        : [],
    sufficiency: levelForMonths(nets.length),
    ...(nets.length >= 2
      ? {}
      : { unavailableReason: 'Needs at least two completed months of history.' }),
  });

  const incomes = series(history, (month) => month.incomeMinor);
  indicators.push({
    key: `cash-flow:income-stability:${currency}`,
    group: 'cash_flow',
    title: 'Income stability',
    definition:
      'Recorded income per completed month. It counts as varying when the gap between the highest and lowest month is more than half the typical (median) month.',
    currency,
    status: incomes.length >= 3 ? 'available' : 'unavailable',
    ...(incomes.length >= 3
      ? {
          headline: textFigure(
            'Monthly income',
            isIrregular(incomes) ? 'varies a lot' : 'fairly steady',
          ),
        }
      : {}),
    figures:
      incomes.length >= 3
        ? [
            figure('Typical month', median(incomes)),
            figure('Lowest month', lowest(incomes)),
            figure('Highest month', highest(incomes)),
          ]
        : [],
    sufficiency: levelForMonths(incomes.length),
    ...(incomes.length >= 3
      ? {}
      : { unavailableReason: 'Needs at least three completed months of history.' }),
  });

  // --- Budgets ---------------------------------------------------------------------------------
  const summary = input.budgetSummary;
  const counts = summary?.statusCounts;
  const budgetCount =
    counts === undefined ? 0 : Object.values(counts).reduce((total, value) => total + value, 0);
  const monthly = summary?.totals.find((entry) => entry.period === 'monthly');
  indicators.push({
    key: `budgets:status:${currency}`,
    group: 'budgets',
    title: 'Budgets this period',
    definition:
      'Current budgets in this currency by status, and the room left in this month’s budgets (limits minus spending, without counting a category twice).',
    currency,
    ...(monthly === undefined ? {} : { period: { from: monthly.from, to: monthly.to } }),
    status: budgetCount > 0 ? 'available' : 'unavailable',
    ...(counts === undefined || budgetCount === 0
      ? {}
      : {
          headline: textFigure(
            'Over limit',
            `${(counts.over_budget + counts.limit_reached).toString()} of ${budgetCount.toString()}`,
          ),
        }),
    figures:
      counts === undefined || budgetCount === 0
        ? []
        : [
            textFigure('Near the limit', counts.approaching_limit.toString()),
            textFigure('On track', counts.on_track.toString()),
            ...(monthly === undefined
              ? []
              : [figure('Room left this month', BigInt(monthly.remainingMinor))]),
          ],
    sufficiency: budgetCount > 0 ? 'strong' : 'insufficient',
    ...(budgetCount > 0
      ? {}
      : { unavailableReason: 'You have no current budgets in this currency.' }),
    link: { label: 'Open budgets', target: { kind: 'budgets' } },
  });
  indicators.push({
    key: `budgets:repeated:${currency}`,
    group: 'budgets',
    title: 'Repeated overspending',
    definition:
      'Monthly budgets that went over their limit in at least two of the last four completed months.',
    currency,
    status: budgetCount > 0 ? 'available' : 'unavailable',
    ...(budgetCount > 0
      ? { headline: textFigure('Budgets', input.repeatedOverspending.length.toString()) }
      : {}),
    figures: input.repeatedOverspending
      .slice(0, 6)
      .map((name) => textFigure(name.slice(0, 120), 'over in 2 or more months')),
    sufficiency: budgetCount > 0 ? levelForMonths(history.months.length) : 'insufficient',
    ...(budgetCount > 0
      ? {}
      : { unavailableReason: 'You have no current budgets in this currency.' }),
  });

  // --- Recurring obligations -------------------------------------------------------------------
  const typicalIncome = median(incomes.slice(-RECENT_MONTHS));
  const next30 = input.next30Expenses;
  const obligationShare =
    typicalIncome > 0n ? shareBasisPoints(next30.amountMinor, typicalIncome) : undefined;
  indicators.push({
    key: `recurring:share:${currency}`,
    group: 'recurring',
    title: 'Scheduled bills against income',
    definition:
      'Scheduled bills and subscriptions due in the next 30 days (overdue ones included), as a share of your typical monthly income over the last three completed months. Both are in this currency.',
    currency,
    period: { from: input.today, to: addDaysToIsoDate(input.today, 30) },
    status: obligationShare === undefined ? 'unavailable' : 'available',
    ...(obligationShare === undefined
      ? { unavailableReason: 'No recorded income in recent completed months to compare with.' }
      : { headline: textFigure('Share of typical income', formatBasisPoints(obligationShare)) }),
    figures: [
      figure(
        'Scheduled in the next 30 days',
        next30.amountMinor,
        `${next30.count.toString()} payments`,
      ),
      ...(typicalIncome > 0n ? [figure('Typical monthly income', typicalIncome)] : []),
    ],
    sufficiency: levelForMonths(Math.min(RECENT_MONTHS, incomes.length)),
    link: { label: 'Open bills and recurring payments', target: { kind: 'recurring' } },
  });
  const subscriptions = input.subscriptions;
  indicators.push({
    key: `recurring:subscriptions:${currency}`,
    group: 'recurring',
    title: 'Subscription commitments',
    definition:
      'Active subscriptions you entered and their estimated charges (amount × charges due in the window). Nothing here was detected from a bank.',
    currency,
    status:
      subscriptions === undefined || subscriptions.activeCount === 0 ? 'unavailable' : 'available',
    ...(subscriptions === undefined || subscriptions.activeCount === 0
      ? { unavailableReason: 'You have no active subscriptions in this currency.' }
      : { headline: textFigure('Active subscriptions', subscriptions.activeCount.toString()) }),
    figures:
      subscriptions === undefined || subscriptions.activeCount === 0
        ? []
        : [
            figure('Next 30 days (estimate)', BigInt(subscriptions.next30Days.amountMinor)),
            figure('Next 12 months (estimate)', BigInt(subscriptions.next12Months.amountMinor)),
          ],
    sufficiency: 'strong',
    link: { label: 'Open subscriptions', target: { kind: 'subscriptions' } },
  });

  // --- Savings goals ---------------------------------------------------------------------------
  const goals = input.goals.filter((goal) => goal.state !== 'reached');
  const onTrack = goals.filter((goal) => goal.state === 'on_track').length;
  const behind = goals.filter(
    (goal) => goal.state === 'behind' || goal.state === 'target_date_passed',
  ).length;
  const required = goals.reduce(
    (total, goal) => total + BigInt(goal.requiredMonthlyMinor ?? '0'),
    0n,
  );
  indicators.push({
    key: `goals:progress:${currency}`,
    group: 'goals',
    title: 'Savings-goal pace',
    definition:
      'Open goals in this currency compared with their target dates at the pace of your recent allocations, and the total needed per month to meet every target date. Goal progress is planning, not an account balance.',
    currency,
    status: goals.length > 0 ? 'available' : 'unavailable',
    ...(goals.length > 0
      ? { headline: textFigure('On track', `${onTrack.toString()} of ${goals.length.toString()}`) }
      : { unavailableReason: 'You have no open savings goals in this currency.' }),
    figures:
      goals.length > 0
        ? [
            textFigure('Behind or past the date', behind.toString()),
            textFigure(
              'Without a usable pace yet',
              goals.filter((goal) => goal.state === 'insufficient_history').length.toString(),
            ),
            ...(required > 0n ? [figure('Needed per month for every target date', required)] : []),
          ]
        : [],
    sufficiency: goals.length > 0 ? 'moderate' : 'insufficient',
    link: { label: 'Open savings goals', target: { kind: 'goals' } },
  });

  // --- Liquidity -------------------------------------------------------------------------------
  const { accounts } = input;
  indicators.push({
    key: `liquidity:position:${currency}`,
    group: 'liquidity',
    title: 'Money held and money owed',
    definition:
      'Balances of your active accounts now. Money in cash, bank, savings, and wallet accounts is shown apart from investment and other accounts (their values are what you entered); cards and loans are money owed and are never added to money held. This is not a full net worth.',
    currency,
    status:
      accounts.cashLikeAccounts + accounts.otherAssetAccounts + accounts.liabilityAccounts > 0
        ? 'available'
        : 'unavailable',
    headline: figure('Cash, bank, savings, and wallets', accounts.cashLikeMinor),
    figures: [
      figure('Investment and other accounts', accounts.otherAssetsMinor),
      figure('Owed on cards and loans', accounts.owedMinor),
      figure(
        'Held minus owed',
        accounts.cashLikeMinor + accounts.otherAssetsMinor - accounts.owedMinor,
      ),
    ],
    sufficiency: 'strong',
    link: { label: 'Open accounts', target: { kind: 'accounts' } },
  });
  const typicalSpending = median(series(history, (month) => month.expenseMinor));
  const months = tenthsText(accounts.cashLikeMinor, typicalSpending);
  indicators.push({
    key: `liquidity:coverage:${currency}`,
    group: 'liquidity',
    title: 'Money held compared with spending',
    definition:
      'Money in cash, bank, savings, and wallet accounts divided by your typical (median) monthly spending in completed months. A comparison only: CalmCash does not know what this money is set aside for, so it is not called an emergency fund.',
    currency,
    status: months === undefined ? 'unavailable' : 'available',
    ...(months === undefined
      ? { unavailableReason: 'No completed month of recorded spending to compare with.' }
      : { headline: textFigure('Months of typical spending', months) }),
    figures: [
      figure('Cash, bank, savings, and wallets', accounts.cashLikeMinor),
      ...(typicalSpending > 0n ? [figure('Typical monthly spending', typicalSpending)] : []),
    ],
    sufficiency: levelForMonths(history.months.length),
  });

  return indicators;
}
