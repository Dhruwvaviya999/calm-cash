import type { ScenarioAdjustmentDto, ScenarioDefinitionInput } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  budgetFlags,
  recommendBudgets,
  suggestionsFor,
  type MonthlyBudgetRef,
} from './budget-recommendations';
import type { PendingOccurrence } from './cash-flow-forecast';
import { healthIndicators, type HealthInput } from './financial-health';
import { outcomeFor, projectGoal, type GoalInput } from './goal-projections';
import { buildHistory, type History } from './history';
import type { MonthlyCategoryRow } from './intelligence.repository';
import { buildRecommendations } from './recommendations';
import {
  simulateScenario,
  type ScenarioBase,
  type ScenarioRefs,
  type ScenarioSimulation,
} from './scenarios';
import { expectedRemaining, forecastCategories } from './spending-forecast';

const TODAY = '2026-11-03';
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const DINING = '0190a1b2-0000-7000-8000-00000000d1e0';
const GROCERY = '0190a1b2-0000-7000-8000-00000000a0c0';
const SUB = '0190a1b2-0000-7000-8000-0000000000b1';
const GOAL = '0190a1b2-0000-7000-8000-0000000000c1';

function spend(
  month: string,
  categoryId: string,
  name: string,
  totalMinor: bigint,
  count = 5,
): MonthlyCategoryRow {
  return {
    month,
    type: 'expense',
    categoryId,
    name,
    archived: false,
    scheduled: false,
    totalMinor,
    count,
  };
}

function history(rows: MonthlyCategoryRow[], first = '2026-05-01'): History {
  return buildHistory(rows, TODAY, first);
}

describe('category spending predictions', () => {
  it('spreads the typical month over the days still to come', () => {
    // Typical ₹3,000; 10 of 30 days gone → 20 days left → ₹2,000 still expected.
    expect(expectedRemaining(300_000n, { daysElapsed: 10, daysInPeriod: 30 })).toBe(200_000n);
    expect(expectedRemaining(300_000n, { daysElapsed: 0, daysInPeriod: 30 })).toBe(300_000n);
    expect(expectedRemaining(300_000n, { daysElapsed: 31, daysInPeriod: 30 })).toBe(0n);
  });

  it('uses the median so one large purchase is not treated as a habit', () => {
    const past = history(
      [
        spend('2026-07', DINING, 'Dining', 100_000n),
        spend('2026-08', DINING, 'Dining', 120_000n),
        spend('2026-09', DINING, 'Dining', 5_000_000n),
        spend('2026-10', DINING, 'Dining', 110_000n),
      ],
      '2026-07-01',
    );
    const [dining] = forecastCategories(
      past,
      [{ key: DINING, categoryId: DINING, name: 'Dining', archived: false, amountMinor: 30_000n }],
      { daysElapsed: 3, daysInPeriod: 30 },
      new Map(),
    );
    // Median of 100 000, 110 000, 120 000, 5 000 000 = (110 000 + 120 000) ÷ 2 = 115 000.
    // Expected remaining = 115 000 × 27 ÷ 30 = 103 500; month end = 30 000 + 103 500 = 133 500.
    expect(dining?.history.medianMinor).toBe('115000');
    expect(dining?.estimate).toEqual({
      status: 'available',
      expectedRemainingMinor: '103500',
      estimatedPeriodEndMinor: '133500',
    });
    expect(dining?.trend).toBe('unknown'); // fewer than six months
  });

  it('shows only the actual amount for a category without enough history', () => {
    const past = history([spend('2026-10', DINING, 'Dining', 100_000n, 12)], '2026-10-01');
    const items = forecastCategories(
      past,
      [
        {
          key: GROCERY,
          categoryId: GROCERY,
          name: 'Groceries',
          archived: false,
          amountMinor: 40_000n,
        },
      ],
      { daysElapsed: 3, daysInPeriod: 30 },
      new Map(),
    );
    expect(items.find((item) => item.name === 'Groceries')?.estimate).toEqual({
      status: 'unavailable',
      reason: 'insufficient_history',
    });
    expect(items.find((item) => item.name === 'Groceries')?.actualToDateMinor).toBe('40000');
  });
});

describe('budget recommendations', () => {
  const months = MONTHS.slice(2).map((month, index) => ({
    month,
    amountMinor: [400_000n, 500_000n, 450_000n, 600_000n][index] ?? 0n,
    count: 5,
  }));

  it('suggests the average and a conservative target, with how many months fit', () => {
    // Mean = 1 950 000 ÷ 4 = 487 500 → rounded up to ₹100 steps → 490 000 (400 000 and 450 000 fit: 2 of 4).
    // Lower quartile (nearest rank) = 400 000 → 400 000 (1 of 4 months within).
    expect(suggestionsFor(months, 'INR')).toEqual([
      expect.objectContaining({
        basis: 'historical_average',
        limitMinor: '490000',
        monthsWithin: 2,
        monthsConsidered: 4,
      }),
      expect.objectContaining({
        basis: 'conservative',
        limitMinor: '400000',
        monthsWithin: 1,
        monthsConsidered: 4,
      }),
    ]);
  });

  it('flags repeated overspending, unused budgets, and limits below typical spending', () => {
    const over: MonthlyBudgetRef = {
      budgetId: 'b1',
      name: 'Dining',
      categoryId: DINING,
      limitMinor: 300_000n,
      recent: ['2026-07', '2026-08', '2026-09', '2026-10'].map((month, index) => ({
        from: `${month}-01`,
        to: `${month}-28`,
        spentMinor: [350_000n, 280_000n, 400_000n, 310_000n][index] ?? 0n,
        limitMinor: 300_000n,
        status: index === 1 ? 'on_track' : 'over_budget',
      })),
    };
    const codes = budgetFlags(months, over, 'INR').map((flag) => flag.code);
    expect(codes).toContain('repeated_overspending');
    expect(codes).toContain('limit_below_typical'); // 300 000 < lower quartile 400 000

    const unused: MonthlyBudgetRef = {
      ...over,
      limitMinor: 2_000_000n,
      recent: over.recent.map((period) => ({
        ...period,
        spentMinor: 100_000n,
        limitMinor: 2_000_000n,
        status: 'on_track',
      })),
    };
    const flags = budgetFlags(months, unused, 'INR');
    expect(flags.map((flag) => flag.code)).toEqual(['consistently_unused']);
    expect(flags[0]?.message).toMatch(/not a reason to remove it/);
  });

  it('keeps each currency apart and only proposes values for the form', () => {
    const past = history(MONTHS.map((month) => spend(month, DINING, 'Dining', 300_000n)));
    const [item] = recommendBudgets(past, [], 'USD');
    expect(item).toMatchObject({
      currency: 'USD',
      prefill: { currency: 'USD', period: 'monthly', categoryId: DINING },
    });
    expect(item?.prefill.budgetId).toBeUndefined(); // a new budget, opened in the ordinary form
  });
});

function goal(overrides: Partial<GoalInput> = {}): GoalInput {
  return {
    goalId: GOAL,
    name: 'Laptop',
    currency: 'INR',
    status: 'active',
    targetMinor: 10_000_000n,
    savedMinor: 4_000_000n,
    percent: { status: 'available', basisPoints: '4000' },
    contributionCount: 4,
    targetDate: '2027-05-03',
    firstContribution: '2026-07-01',
    monthly: new Map([
      ['2026-07', { amountMinor: 1_000_000n, count: 1 }],
      ['2026-08', { amountMinor: 1_000_000n, count: 1 }],
      ['2026-09', { amountMinor: 1_000_000n, count: 1 }],
      ['2026-10', { amountMinor: 1_000_000n, count: 1 }],
    ]),
    ...overrides,
  };
}

describe('savings-goal projections', () => {
  it('projects completion from the recent pace and the amount needed per month', () => {
    const projection = projectGoal(goal(), TODAY);
    // Pace: 4 000 000 over July–October = 1 000 000 a month. Remaining 6 000 000 → 6 months →
    // 2027-05-03, the target date: on track. Required: 6 000 000 ÷ 6 months = 1 000 000.
    expect(projection.pace).toEqual({
      status: 'available',
      monthlyAverageMinor: '1000000',
      monthsUsed: 4,
      contributionCount: 4,
    });
    expect(projection.projectedCompletionDate).toBe('2027-05-03');
    expect(projection.requiredMonthlyMinor).toBe('1000000');
    expect(projection.state).toBe('on_track');
  });

  it('is behind with a slower pace and suggests the monthly amount or a later date', () => {
    const projection = projectGoal(goal({ targetDate: '2027-02-03' }), TODAY);
    // 3 months left: ⌈6 000 000 ÷ 3⌉ = 2 000 000 a month needed.
    expect(projection.state).toBe('behind');
    expect(projection.requiredMonthlyMinor).toBe('2000000');
    expect(projection.suggestions.map((item) => item.kind)).toEqual([
      'increase_contribution',
      'extend_target_date',
    ]);
  });

  it('shows the required amount but no date without contribution history', () => {
    const projection = projectGoal(
      goal({
        contributionCount: 0,
        savedMinor: 0n,
        firstContribution: undefined,
        monthly: new Map(),
      }),
      TODAY,
    );
    expect(projection.pace).toEqual({ status: 'unavailable', reason: 'no_contributions' });
    expect(projection.projectedCompletionDate).toBeUndefined();
    expect(projection.state).toBe('insufficient_history');
    expect(projection.requiredMonthlyMinor).toBe('1666667'); // ⌈10 000 000 ÷ 6⌉
  });

  it('handles missing and expired target dates and over-completed goals', () => {
    expect(projectGoal(goal({ targetDate: undefined }), TODAY).state).toBe('no_target_date');
    const expired = projectGoal(goal({ targetDate: '2026-10-01' }), TODAY);
    expect(expired.state).toBe('target_date_passed');
    expect(expired.requiredMonthlyMinor).toBeUndefined();
    const over = projectGoal(goal({ savedMinor: 12_000_000n }), TODAY);
    expect(over).toMatchObject({ state: 'reached', remainingMinor: '-2000000', suggestions: [] });
    expect(outcomeFor(10n, 0n, 'paused', undefined, 5n, TODAY).state).toBe('paused');
  });
});

describe('scenario simulation', () => {
  const rows = MONTHS.flatMap((month) => [
    spend(month, DINING, 'Dining', 400_000n),
    spend(month, GROCERY, 'Groceries', 600_000n),
  ]);
  const base: ScenarioBase = {
    currency: 'INR',
    today: TODAY,
    heldMinor: 5_000_000n,
    owedMinor: 2_000_000n,
    pending: [
      {
        scheduleId: SUB,
        currency: 'INR',
        name: 'Streaming',
        type: 'expense',
        isSubscription: true,
        categoryId: undefined,
        scheduledDate: '2026-11-20',
        dueDate: '2026-11-20',
        status: 'upcoming',
        postponed: false,
        amountMinor: 50_000n,
      } satisfies PendingOccurrence,
    ],
    history: history(rows),
  };
  const refs: ScenarioRefs = {
    categories: new Map([
      [DINING, { name: 'Dining', kind: 'expense', parentId: null, archived: false }],
      [GROCERY, { name: 'Groceries', kind: 'expense', parentId: null, archived: false }],
    ]),
    schedules: new Map([
      [SUB, { name: 'Streaming', type: 'expense', currency: 'INR', active: true }],
    ]),
    goals: new Map([[GOAL, goal()]]),
    budgets: [{ budgetId: 'b1', name: 'Dining', categoryId: DINING, limitMinor: 350_000n }],
  };
  const run = (
    adjustments: ScenarioAdjustmentDto[],
    horizonDays: ScenarioDefinitionInput['horizonDays'] = 30,
  ): ScenarioSimulation =>
    simulateScenario({ name: 'Test', currency: 'INR', horizonDays, adjustments }, base, refs);

  it('reduces a category by a percentage of its typical everyday month', () => {
    const result = run([
      {
        kind: 'category_spending',
        categoryId: DINING,
        direction: 'decrease',
        change: { by: 'percent', percentBp: 1500 },
      },
    ]);
    // Typical dining 400 000 × 15 % = 60 000 a month; over 30 days 60 000 × 30 × 48 ÷ 1461 = 59 137.57… → 59 138.
    expect(result.differenceMinor).toBe('59138');
    expect(result.effects[0]).toMatchObject({ status: 'applied', positionChangeMinor: '59138' });
    // Budget: typical 400 000 against a 350 000 limit; with the change 340 000.
    expect(result.budgetImpacts).toEqual([
      expect.objectContaining({
        budgetId: 'b1',
        baselineMonthlyMinor: '400000',
        simulatedMonthlyMinor: '340000',
      }),
    ]);
    // Baseline: 3 000 000 − 50 000 − (1 000 000 × 30 × 48 ÷ 1461 = 985 626.28… → 985 626) = 1 964 374.
    expect(result.baseline.endingPositionMinor).toBe('1964374');
    expect(result.simulated.endingPositionMinor).toBe('2023512');
  });

  it('cancels a subscription, adds income and a one-off expense', () => {
    const result = run([
      { kind: 'cancel_schedule', scheduleId: SUB },
      { kind: 'monthly_income', label: 'Raise', amountMinor: 1_461_000n.toString() },
      { kind: 'one_time_expense', label: 'Phone', amountMinor: '2000000', date: '2026-11-10' },
    ]);
    // +50 000 (no charge) + 1 461 000 × 30 × 48 ÷ 1461 (= 1 440 000) − 2 000 000 = −510 000.
    expect(result.effects.map((effect) => effect.positionChangeMinor)).toEqual([
      '50000',
      '1440000',
      '-2000000',
    ]);
    expect(result.differenceMinor).toBe('-510000');
  });

  it('pays debt from money held without changing the net position', () => {
    const result = run([{ kind: 'debt_payment', amountMinor: '1500000' }]);
    expect(result.differenceMinor).toBe('0');
    expect(result.heldAndOwed).toEqual({
      baselineHeldMinor: '5000000',
      baselineOwedMinor: '2000000',
      simulatedHeldMinor: '3500000',
      simulatedOwedMinor: '500000',
    });
    expect(run([{ kind: 'debt_payment', amountMinor: '3000000' }]).effects[0]?.status).toBe(
      'not_applicable',
    );
  });

  it('shows goal impacts without moving money', () => {
    const result = run([
      { kind: 'goal_contribution', goalId: GOAL, monthlyAmountMinor: '2000000' },
      { kind: 'goal_target_date', goalId: GOAL, targetDate: '2027-02-03' },
    ]);
    expect(result.differenceMinor).toBe('0');
    // Baseline: on track for 2027-05-03. Simulated: 2 000 000 a month → 3 months → 2027-02-03.
    expect(result.goalImpacts).toEqual([
      {
        goalId: GOAL,
        name: 'Laptop',
        baseline: {
          state: 'on_track',
          requiredMonthlyMinor: '1000000',
          projectedCompletionDate: '2027-05-03',
        },
        simulated: {
          state: 'on_track',
          requiredMonthlyMinor: '2000000',
          projectedCompletionDate: '2027-02-03',
        },
      },
    ]);
  });

  it('marks changes it cannot apply instead of guessing', () => {
    const result = run([
      {
        kind: 'category_spending',
        categoryId: SUB,
        direction: 'decrease',
        change: { by: 'percent', percentBp: 1000 },
      },
      { kind: 'one_time_expense', label: 'Later', amountMinor: '100', date: '2027-06-01' },
      { kind: 'goal_target_date', goalId: GOAL, targetDate: '2026-11-01' },
    ]);
    expect(result.effects.map((effect) => effect.status)).toEqual([
      'not_applicable',
      'not_applicable',
      'not_applicable',
    ]);
    expect(result.differenceMinor).toBe('0');
  });

  it('caps a reduction by amount at the typical month and limits changes to N months', () => {
    const capped = run([
      {
        kind: 'category_spending',
        categoryId: DINING,
        direction: 'decrease',
        change: { by: 'amount', amountMinor: '900000' },
      },
    ]);
    expect(capped.effects[0]?.reason).toMatch(/cannot go below zero/);
    const limited = run(
      [{ kind: 'monthly_expense', label: 'Rent rise', amountMinor: '200000', months: 1 }],
      90,
    );
    // One month from 3 Nov is 30 days: 200 000 × 30 × 48 ÷ 1461 = 197 125.25… → 197 125.
    expect(limited.differenceMinor).toBe('-197125');
  });

  it('never changes its inputs (a simulation is not a financial operation)', () => {
    const before = JSON.stringify({ ...base, history: undefined }, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    run([
      { kind: 'debt_payment', amountMinor: '100' },
      { kind: 'cancel_schedule', scheduleId: SUB },
    ]);
    expect(
      JSON.stringify({ ...base, history: undefined }, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).toBe(before);
  });
});

describe('financial health and recommendations', () => {
  const past = history(
    MONTHS.flatMap((month) => [
      spend(month, DINING, 'Dining', 400_000n),
      {
        month,
        type: 'income' as const,
        categoryId: null,
        name: null,
        archived: false,
        scheduled: false,
        totalMinor: 1_000_000n,
        count: 1,
      },
    ]),
  );
  const inputs: HealthInput = {
    currency: 'INR',
    today: TODAY,
    history: past,
    budgetSummary: undefined,
    repeatedOverspending: [],
    next30Expenses: { amountMinor: 250_000n, count: 2 },
    subscriptions: undefined,
    goals: [],
    accounts: {
      cashLikeMinor: 1_200_000n,
      otherAssetsMinor: 0n,
      owedMinor: 0n,
      cashLikeAccounts: 1,
      otherAssetAccounts: 0,
      liabilityAccounts: 0,
    },
  };

  it('explains each indicator with its own definition and values (no overall score)', () => {
    const indicators = healthIndicators(inputs);
    const byKey = new Map(indicators.map((indicator) => [indicator.key, indicator]));
    // (3 000 000 − 1 200 000) ÷ 3 000 000 = 60 %.
    expect(byKey.get('cash-flow:savings-rate:INR')?.headline).toEqual({
      label: 'Savings rate',
      text: '60%',
    });
    // 250 000 ÷ 1 000 000 = 25 %.
    expect(byKey.get('recurring:share:INR')?.headline?.text).toBe('25%');
    // 1 200 000 ÷ 400 000 = 3.0 months of typical spending — and never called an emergency fund.
    expect(byKey.get('liquidity:coverage:INR')?.headline?.text).toBe('3.0');
    expect(JSON.stringify(indicators)).not.toMatch(/score/i);
    expect(indicators.every((indicator) => indicator.definition.length > 0)).toBe(true);
  });

  it('makes no recommendation from insufficient history and respects dismissals', () => {
    const base = {
      currency: 'INR' as const,
      today: TODAY,
      calculatedAt: '2026-11-03T06:00:00.000Z',
      forecast: undefined,
      budgets: [],
      goals: [projectGoal(goal({ targetDate: '2027-02-03' }), TODAY)],
      subscriptions: [],
      pending: [],
      history: past,
    };
    expect(
      buildRecommendations({ ...base, sufficiency: 'insufficient', marks: new Map() }).items,
    ).toEqual([]);
    const shown = buildRecommendations({ ...base, sufficiency: 'strong', marks: new Map() });
    expect(shown.items.map((item) => item.type)).toEqual(['goal_behind']);
    expect(shown.items[0]?.state).toBe('new');
    expect(shown.items[0]?.observation).toContain('set aside');
    const key = shown.items[0]?.key ?? '';
    expect(
      buildRecommendations({
        ...base,
        sufficiency: 'strong',
        marks: new Map([[key, new Set(['reviewed' as const])]]),
      }).items[0]?.state,
    ).toBe('reviewed');
    const dismissed = buildRecommendations({
      ...base,
      sufficiency: 'strong',
      marks: new Map([[key, new Set(['dismissed' as const])]]),
    });
    expect(dismissed).toEqual({ items: [], dismissedCount: 1 });
  });
});
