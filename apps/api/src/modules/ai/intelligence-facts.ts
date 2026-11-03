import type {
  AssistantBlockDto,
  BudgetRecommendationsDto,
  CashFlowForecastDto,
  CurrencyCashFlowForecastDto,
  FigureDto,
  FinancialHealthDto,
  FinancialRecommendationDto,
  GoalProjectionDto,
  GoalProjectionState,
  ScenarioResultDto,
  SpendingForecastDto,
  SpendingPatternsDto,
} from '@calmcash/shared';

import {
  clip,
  formatBasisPoints,
  formatDate,
  formatMoney,
  formatRange,
} from '../../lib/text-format';

// Answer blocks for the financial-intelligence results (Phase 11), shared by the assistant's tools
// and the plain-word explanations. Every figure is copied from a deterministic result and labelled
// as actual, scheduled, or estimated; the summary is the fixed wording used whenever the model's
// wording is not used. The model sees these blocks only as text facts.

export interface IntelligenceFacts {
  blocks: AssistantBlockDto[];
  summary: string;
}

const LABEL = 120;

function text(label: string, value: string): FigureDto {
  return { label: clip(label, LABEL), text: clip(value, LABEL) };
}

function amount(label: string, amountMinor: string, note?: string): FigureDto {
  return {
    label: clip(label, LABEL),
    amountMinor,
    ...(note === undefined ? {} : { text: clip(note, LABEL) }),
  };
}

function notice(value: string, tone: 'info' | 'warning' = 'info'): AssistantBlockDto {
  return { kind: 'notice', tone, text: clip(value, 300) };
}

export function forecastBlock(
  forecast: CurrencyCashFlowForecastDto,
  range: { from: string; to: string },
): AssistantBlockDto {
  const variable = forecast.variableSpending;
  const income = forecast.estimatedIncome;
  const money = (value: string): string => formatMoney(value, forecast.currency);
  return {
    kind: 'figures',
    title: 'Cash-flow projection (an estimate, not a bank balance)',
    currency: forecast.currency,
    period: range,
    figures: [
      amount('Actual net position now (held minus owed)', forecast.starting.netPositionMinor),
      amount(
        'Scheduled income',
        forecast.scheduledIncome.amountMinor,
        `${forecast.scheduledIncome.count.toString()} expected`,
      ),
      amount(
        'Scheduled bills and subscriptions',
        forecast.scheduledExpenses.amountMinor,
        `${forecast.scheduledExpenses.count.toString()} expected, ${forecast.scheduledExpenses.overdueCount.toString()} overdue`,
      ),
      variable.status === 'available'
        ? amount(
            'Estimated everyday spending',
            variable.amountMinor,
            `estimate from ${variable.monthsUsed.toString()} completed months`,
          )
        : text('Estimated everyday spending', 'not estimated: not enough history'),
      income.status === 'included'
        ? amount('Estimated income without a schedule', income.amountMinor, 'estimate, included')
        : text('Income without a schedule', 'not assumed'),
      amount(
        `Projected net position on ${formatDate(range.to)}`,
        forecast.projected.endingPositionMinor,
        'estimate',
      ),
      ...(forecast.projected.lowMinor === undefined || forecast.projected.highMinor === undefined
        ? []
        : [
            text(
              'Range from your lowest and highest month',
              `${money(forecast.projected.lowMinor)} to ${money(forecast.projected.highMinor)}`,
            ),
          ]),
    ],
  };
}

export function cashFlowFacts(dto: CashFlowForecastDto): IntelligenceFacts {
  const range = { from: dto.from, to: dto.to };
  const blocks: AssistantBlockDto[] = dto.forecasts.map((forecast) =>
    forecastBlock(forecast, range),
  );
  const warnings = dto.forecasts.flatMap((forecast) =>
    forecast.warnings.filter((warning) => warning.code !== 'account_allocation').slice(0, 2),
  );
  for (const warning of [...dto.warnings, ...warnings].slice(0, 3)) {
    blocks.push(notice(warning.message, 'warning'));
  }
  const first = dto.forecasts[0];
  return {
    blocks,
    summary:
      first === undefined
        ? 'There is nothing to project yet.'
        : `If things go as scheduled and everyday spending stays typical, your net position in ${first.currency} could be about ${formatMoney(first.projected.endingPositionMinor, first.currency)} on ${formatDate(dto.to)}, compared with ${formatMoney(first.starting.netPositionMinor, first.currency)} now. This is an estimate, not a guaranteed balance.`,
  };
}

export function spendingForecastFacts(dto: SpendingForecastDto): IntelligenceFacts {
  const money = (value: string): string => formatMoney(value, dto.currency);
  const figures: FigureDto[] = dto.categories
    .slice(0, 8)
    .map((item) =>
      item.estimate.status === 'available'
        ? amount(
            item.name,
            item.estimate.estimatedPeriodEndMinor,
            `estimate; actual so far ${money(item.actualToDateMinor)}`,
          )
        : amount(
            item.name,
            item.actualToDateMinor,
            'actual so far; not enough history to estimate',
          ),
    );
  return {
    blocks: [
      {
        kind: 'figures',
        title: `Estimated spending by category, ${dto.period === 'this-month' ? 'this month' : 'next month'}`,
        currency: dto.currency,
        period: { from: dto.from, to: dto.to },
        figures: [
          amount('Actual so far', dto.totals.actualToDateMinor),
          amount('Estimated month end', dto.totals.estimatedPeriodEndMinor, 'estimate'),
          ...figures,
        ],
      },
    ],
    summary: `By the end of ${formatRange(dto.from, dto.to)} your spending in ${dto.currency} could be about ${money(dto.totals.estimatedPeriodEndMinor)} (${money(dto.totals.actualToDateMinor)} recorded so far). Estimates use your typical month per category and are not guaranteed.`,
  };
}

export function patternsFacts(dto: SpendingPatternsDto): IntelligenceFacts {
  const money = (value: string): string => formatMoney(value, dto.currency);
  const blocks: AssistantBlockDto[] = [
    {
      kind: 'figures',
      title: 'Spending patterns (actual)',
      currency: dto.currency,
      period: { from: dto.from, to: dto.to },
      figures: [
        amount(
          'Spending',
          dto.totals.expenseMinor,
          `${dto.totals.expenseCount.toString()} expenses`,
        ),
        amount('Income', dto.totals.incomeMinor, `${dto.totals.incomeCount.toString()} entries`),
        ...(dto.distribution === undefined
          ? []
          : [
              amount('Typical (median) expense', dto.distribution.medianMinor),
              amount(
                'Largest expense',
                dto.distribution.largest.amountMinor,
                clip(dto.distribution.largest.merchant ?? dto.distribution.largest.description, 60),
              ),
            ]),
        ...dto.categories
          .slice(0, 4)
          .map((item) =>
            amount(
              item.name,
              item.totalMinor,
              item.change.status === 'available'
                ? `${formatBasisPoints(BigInt(item.change.basisPoints))} vs the period before`
                : 'nothing in the period before',
            ),
          ),
      ],
    },
  ];
  if (dto.topMerchantsBySpend.length > 0) {
    blocks.push({
      kind: 'figures',
      title: 'Merchants with the most spending',
      currency: dto.currency,
      period: { from: dto.from, to: dto.to },
      figures: dto.topMerchantsBySpend
        .slice(0, 5)
        .map((item) =>
          amount(clip(item.label, 80), item.totalMinor, `${item.count.toString()} payments`),
        ),
    });
  }
  return {
    blocks,
    summary: `From ${formatRange(dto.from, dto.to)} you recorded ${money(dto.totals.expenseMinor)} of spending in ${dto.currency}. Changes compare with the same number of days before; they show what changed, not why.`,
  };
}

export function budgetFacts(dto: BudgetRecommendationsDto): IntelligenceFacts {
  const money = (value: string): string => formatMoney(value, dto.currency);
  const figures = dto.items.slice(0, 8).map((item) => {
    const average = item.suggestions.find((entry) => entry.basis === 'historical_average');
    return average === undefined
      ? amount(item.categoryName, item.history.averageMinor, 'average month')
      : amount(
          item.categoryName,
          average.limitMinor,
          `suggested limit; average month ${money(item.history.averageMinor)}${item.existingBudget === undefined ? '' : `; limit now ${money(item.existingBudget.limitMinor)}`}`,
        );
  });
  return {
    blocks:
      figures.length === 0
        ? [notice('There is not enough spending history for budget suggestions yet.')]
        : [
            {
              kind: 'figures',
              title: 'Budget suggestions from your completed months',
              currency: dto.currency,
              period: dto.history,
              figures,
            },
          ],
    summary:
      'These limits come from your own completed months (the average month, rounded up). They are starting points, not optimal values, and nothing changes until you save a budget yourself.',
  };
}

const GOAL_STATE_WORDS: Readonly<Record<GoalProjectionState, string>> = {
  reached: 'target reached',
  on_track: 'on track at the recent pace',
  behind: 'behind the target date at the recent pace',
  no_target_date: 'no target date',
  target_date_passed: 'target date passed',
  insufficient_history: 'not enough allocation history for a date',
  paused: 'paused',
};

export function goalFacts(goals: readonly GoalProjectionDto[]): IntelligenceFacts {
  const blocks: AssistantBlockDto[] = goals.slice(0, 6).map((goal) => ({
    kind: 'figures',
    title: clip(goal.name, 120),
    currency: goal.currency,
    figures: [
      amount('Set aside (planning, not a balance)', goal.savedMinor),
      amount('Target', goal.targetMinor),
      amount('Remaining', goal.remainingMinor),
      text('Status', GOAL_STATE_WORDS[goal.state]),
      ...(goal.requiredMonthlyMinor === undefined
        ? []
        : [amount('Needed per month for the target date', goal.requiredMonthlyMinor)]),
      ...(goal.pace.status === 'available'
        ? [amount('Recent pace per month', goal.pace.monthlyAverageMinor)]
        : []),
      ...(goal.projectedCompletionDate === undefined
        ? []
        : [text('Estimated completion', formatDate(goal.projectedCompletionDate))]),
    ],
  }));
  return {
    blocks: blocks.length === 0 ? [notice('You have no current savings goals.')] : blocks,
    summary:
      'Goal progress is what you set aside in CalmCash. Completion dates are estimates from your recent allocations; goals never receive money automatically.',
  };
}

export function healthFacts(dto: FinancialHealthDto): IntelligenceFacts {
  const figures: FigureDto[] = dto.indicators
    .filter((indicator) => indicator.status === 'available' && indicator.headline !== undefined)
    .slice(0, 9)
    .flatMap((indicator) => {
      const headline = indicator.headline;
      if (headline === undefined) return [];
      return [
        {
          label: clip(`${indicator.title}: ${headline.label}`, LABEL),
          ...(headline.amountMinor === undefined ? {} : { amountMinor: headline.amountMinor }),
          ...(headline.text === undefined ? {} : { text: headline.text }),
        },
      ];
    });
  return {
    blocks: [
      {
        kind: 'figures',
        title: 'Financial health indicators (no overall score)',
        currency: dto.currency,
        figures,
      },
    ],
    summary:
      'Each indicator is one measured fact from your records with its own definition; together they are not a score, and they say nothing about the reasons behind the numbers.',
  };
}

export function recommendationFacts(
  items: readonly FinancialRecommendationDto[],
): IntelligenceFacts {
  const blocks: AssistantBlockDto[] = items.slice(0, 4).map((item) => ({
    kind: 'figures',
    title: clip(item.title, 120),
    currency: item.currency,
    ...(item.period === undefined ? {} : { period: item.period }),
    figures: [
      text('What the records show', item.observation),
      text('What you could consider', item.suggestion),
      ...item.metrics.slice(0, 4),
    ],
  }));
  return {
    blocks: blocks.length === 0 ? [notice('Nothing stands out to recommend right now.')] : blocks,
    summary:
      items.length === 0
        ? 'Nothing stands out to recommend right now.'
        : `${items[0]?.observation ?? ''} ${items[0]?.suggestion ?? ''}`.trim(),
  };
}

export function scenarioFacts(dto: ScenarioResultDto): IntelligenceFacts {
  const money = (value: string): string => formatMoney(value, dto.currency);
  const difference = BigInt(dto.differenceMinor);
  return {
    blocks: [
      {
        kind: 'figures',
        title: clip(`Simulation: ${dto.name}`, 120),
        currency: dto.currency,
        period: { from: dto.from, to: dto.to },
        figures: [
          amount(
            'Projected net position without changes',
            dto.baseline.endingPositionMinor,
            'estimate',
          ),
          amount(
            'Projected net position with the changes',
            dto.simulated.endingPositionMinor,
            'simulation',
          ),
          amount('Difference', dto.differenceMinor),
          ...dto.effects
            .slice(0, 5)
            .map((effect) =>
              effect.status === 'applied'
                ? amount(
                    clip(effect.description, LABEL),
                    effect.positionChangeMinor,
                    'effect on the projection',
                  )
                : text(
                    clip(effect.description, LABEL),
                    `not applied: ${effect.reason ?? 'not applicable'}`,
                  ),
            ),
        ],
      },
    ],
    summary: `In this simulation your projected net position on ${formatDate(dto.to)} would be ${money(dto.simulated.endingPositionMinor)} instead of ${money(dto.baseline.endingPositionMinor)}, a difference of ${difference < 0n ? '' : '+'}${money(dto.differenceMinor)}. It is a hypothetical calculation: nothing was recorded or changed.`,
  };
}
