// @vitest-environment jsdom
import type {
  CashFlowForecastDto,
  FinancialRecommendationDto,
  MethodologyDto,
  RecommendationListDto,
  ScenarioResultDto,
} from '@calmcash/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '@/testing/auth';

import {
  buildScenarioInput,
  emptyAdjustment,
  emptyScenarioValues,
} from '../scenarios/scenario-form-model';
import { ScenarioResult } from '../scenarios/components/scenario-result';
import { CashFlowForecastSection } from './components/forecast-section';
import { RecommendationsSection } from './components/overview-section';
import {
  basisPointsFromPercent,
  budgetValuesFromPrefill,
  forecastPoints,
} from './intelligence-presentation';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/insights',
}));

const service = vi.hoisted(() => ({
  getCashFlowForecast: vi.fn(),
  getRecommendations: vi.fn(),
  markRecommendation: vi.fn(),
  explainIntelligence: vi.fn(),
}));
vi.mock('@/services/intelligence.service', () => service);

const CATEGORY = '0193a000-0000-7000-8000-000000000101';
const SCHEDULE = '0193a000-0000-7000-8000-000000000201';
const AT = '2026-11-03T05:00:00.000Z';

const METHOD: MethodologyDto = {
  version: '2026-11.1',
  summary: 'Projected net position = held − owed + scheduled income − scheduled bills − estimate.',
  steps: ['Starting point: balances now.'],
  assumptions: ['Schedules are up to date.'],
  limitations: ['Not a bank balance.'],
};

const SUFFICIENCY = {
  level: 'strong' as const,
  monthsConsidered: 6,
  monthsWithActivity: 6,
  transactionCount: 40,
  firstActivityDate: '2026-04-01',
  notes: [],
};

const FORECAST: CashFlowForecastDto = {
  today: '2026-11-03',
  from: '2026-11-03',
  to: '2026-11-04',
  horizonDays: 7,
  timeZone: 'Asia/Kolkata',
  incomeBasis: 'scheduled',
  calculatedAt: AT,
  availableCurrencies: ['INR'],
  methodology: METHOD,
  warnings: [],
  forecasts: [
    {
      currency: 'INR',
      sufficiency: SUFFICIENCY,
      starting: { heldMinor: '10000000', owedMinor: '1000000', netPositionMinor: '9000000' },
      monthToDate: {
        from: '2026-11-01',
        to: '2026-11-03',
        incomeMinor: '0',
        expenseMinor: '50000',
      },
      scheduledIncome: { amountMinor: '0', count: 0 },
      scheduledExpenses: {
        amountMinor: '2000000',
        count: 1,
        subscriptionMinor: '0',
        overdueMinor: '0',
        overdueCount: 0,
      },
      overdueIncomeNotCounted: { amountMinor: '0', count: 0 },
      variableSpending: {
        status: 'available',
        amountMinor: '19713',
        monthlyBaselineMinor: '300000',
        lowMinor: '19055',
        highMinor: '20370',
        monthsUsed: 6,
      },
      estimatedIncome: {
        status: 'excluded',
        amountMinor: '0',
        monthlyBaselineMinor: '0',
        monthsUsed: 6,
      },
      expectedIncomeMinor: '0',
      expectedExpensesMinor: '2019713',
      projected: {
        endingPositionMinor: '6980287',
        changeMinor: '-2019713',
        lowMinor: '6979630',
        highMinor: '6980945',
      },
      buckets: [
        {
          start: '2026-11-03',
          end: '2026-11-03',
          scheduledIncomeMinor: '0',
          scheduledExpenseMinor: '0',
          estimatedIncomeMinor: '0',
          estimatedVariableMinor: '0',
          projectedPositionMinor: '9000000',
        },
        {
          start: '2026-11-04',
          end: '2026-11-04',
          scheduledIncomeMinor: '0',
          scheduledExpenseMinor: '2000000',
          estimatedIncomeMinor: '0',
          estimatedVariableMinor: '19713',
          projectedPositionMinor: '6980287',
        },
      ],
      items: [
        {
          scheduleId: SCHEDULE,
          name: 'Flat rent',
          type: 'expense',
          isSubscription: false,
          scheduledDate: '2026-11-04',
          dueDate: '2026-11-04',
          status: 'upcoming',
          postponed: false,
          amountMinor: '2000000',
          counted: true,
        },
      ],
      itemsTruncated: false,
      warnings: [
        {
          code: 'account_allocation',
          message: 'This is a projection per currency, not a bank balance.',
        },
      ],
    },
  ],
};

const RECOMMENDATION: FinancialRecommendationDto = {
  key: 'shortfall:INR:2026-11',
  type: 'forecast_shortfall',
  priority: 'medium',
  title: 'Expected spending is higher than expected income in the next 30 days',
  observation: 'CalmCash expects ₹20,197.13 of spending against ₹0.00 of scheduled income.',
  suggestion: 'Check that upcoming bills and income are scheduled correctly.',
  metrics: [{ label: 'Expected spending', amountMinor: '2019713' }],
  currency: 'INR',
  source: 'cash_flow_forecast',
  links: [],
  createdAt: AT,
  state: 'new',
  reevaluation: 'Recalculated on every visit.',
};

const LIST: RecommendationListDto = {
  currency: 'INR',
  currencies: ['INR'],
  calculatedAt: AT,
  sufficiency: SUFFICIENCY,
  items: [RECOMMENDATION],
  dismissedCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('intelligence presentation', () => {
  it('turns typed percentages into basis points exactly', () => {
    expect(basisPointsFromPercent('15')).toBe(1500);
    expect(basisPointsFromPercent('12.5')).toBe(1250);
    expect(basisPointsFromPercent('0')).toBeUndefined();
    expect(basisPointsFromPercent('-5')).toBeUndefined();
    expect(basisPointsFromPercent('1.234')).toBeUndefined();
  });

  it('opens the ordinary budget form with the suggestion, as text the person can change', () => {
    expect(
      budgetValuesFromPrefill({
        categoryId: CATEGORY,
        name: 'Groceries budget',
        currency: 'INR',
        period: 'monthly',
        limitMinor: '500000',
      }),
    ).toEqual({
      name: 'Groceries budget',
      scope: 'category',
      categoryId: CATEGORY,
      limit: '5000.00',
      currency: 'INR',
      period: 'monthly',
    });
  });

  it('charts the projection from the exact strings, today first', () => {
    const [today, tomorrow] = forecastPoints(FORECAST.forecasts[0]?.buckets ?? []);
    expect(today?.position).toBe(9_000_000);
    expect(tomorrow).toMatchObject({ position: 6_980_287, scheduledExpense: 2_000_000 });
  });
});

describe('cash-flow forecast section', () => {
  it('labels actual, scheduled, and estimated figures and explains only on request', async () => {
    service.getCashFlowForecast.mockResolvedValue(FORECAST);
    service.explainIntelligence.mockResolvedValue({
      subject: 'cashflow_forecast',
      explanation: 'If bills arrive as scheduled, you could have about ₹69,802.87.',
      narrative: 'assistant',
      facts: [],
      calculatedAt: AT,
    });
    const user = userEvent.setup();
    renderWithAuth(
      <CashFlowForecastSection currency={undefined} timeZone="Asia/Kolkata" aiAvailable />,
    );

    expect(await screen.findByText('Flat rent')).toBeDefined();
    expect(screen.getByText(/Projected net position on 4 Nov 2026/)).toBeDefined();
    expect(screen.getByText(/Not a guaranteed balance/)).toBeDefined();
    expect(screen.getAllByText('Estimate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Actual').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Scheduled').length).toBeGreaterThan(0);
    expect(service.getCashFlowForecast).toHaveBeenCalledWith(
      { horizon: 30, income: 'scheduled', currency: undefined },
      expect.anything(),
    );
    expect(service.explainIntelligence).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Explain in plain words' }));
    expect(await screen.findByText(/could have about/)).toBeDefined();
    expect(screen.getByText(/figures themselves are unchanged/)).toBeDefined();

    await user.selectOptions(screen.getByRole('combobox'), '90');
    await waitFor(() => {
      expect(service.getCashFlowForecast).toHaveBeenLastCalledWith(
        { horizon: 90, income: 'scheduled', currency: undefined },
        expect.anything(),
      );
    });
  });

  it('hides the explanation without AI and shows an error with a retry', async () => {
    service.getCashFlowForecast
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(FORECAST);
    const user = userEvent.setup();
    renderWithAuth(
      <CashFlowForecastSection currency="INR" timeZone="Asia/Kolkata" aiAvailable={false} />,
    );
    expect(await screen.findByText('The forecast could not be loaded')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Flat rent')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Explain in plain words' })).toBeNull();
  });
});

describe('recommendations section', () => {
  it('separates observation from suggestion and dismisses only on request', async () => {
    service.getRecommendations.mockResolvedValue(LIST);
    service.markRecommendation.mockResolvedValue({ key: RECOMMENDATION.key, state: 'dismissed' });
    const user = userEvent.setup();
    renderWithAuth(
      <RecommendationsSection currency={undefined} timeZone="Asia/Kolkata" aiAvailable={false} />,
    );
    const card = (await screen.findByText(RECOMMENDATION.title)).closest('li');
    expect(card).not.toBeNull();
    const scope = within(card ?? document.body);
    expect(scope.getByText('What the records show:')).toBeDefined();
    expect(scope.getByText('You could consider:')).toBeDefined();
    await user.click(scope.getByRole('button', { name: `Dismiss: ${RECOMMENDATION.title}` }));
    expect(service.markRecommendation).toHaveBeenCalledWith(RECOMMENDATION.key, 'dismiss');
  });
});

describe('scenarios', () => {
  it('builds an exact scenario from typed text and reports field problems', () => {
    const values = emptyScenarioValues('INR');
    const [first] = values.adjustments;
    if (first === undefined) throw new Error('expected a first change');
    const invalid = buildScenarioInput({ ...values, name: '' });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(Object.keys(invalid.errors)).toContain('name');
      expect(invalid.errors['adjustments.0.categoryId']).toBe('Choose a category.');
    }
    const built = buildScenarioInput({
      ...values,
      name: 'Less dining',
      adjustments: [
        { ...first, categoryId: CATEGORY, value: '15', months: '3' },
        { ...emptyAdjustment('monthly_expense'), label: 'Rent rise', amount: '2,000.50' },
      ],
    });
    expect(built).toEqual({
      ok: true,
      input: {
        name: 'Less dining',
        currency: 'INR',
        horizonDays: 90,
        adjustments: [
          {
            kind: 'category_spending',
            categoryId: CATEGORY,
            direction: 'decrease',
            change: { by: 'percent', percentBp: 1500 },
            months: 3,
          },
          { kind: 'monthly_expense', label: 'Rent rise', amountMinor: '200050' },
        ],
      },
    });
    const tooMuch = buildScenarioInput({
      ...values,
      name: 'x',
      adjustments: [{ ...first, categoryId: CATEGORY, value: '150' }],
    });
    expect(tooMuch.ok).toBe(false);
  });

  it('labels every result as a simulation, in neutral ink', () => {
    const result: ScenarioResultDto = {
      scenarioId: '0193a000-0000-7000-8000-000000000301',
      name: 'Less dining',
      currency: 'INR',
      horizonDays: 30,
      from: '2026-11-03',
      to: '2026-12-03',
      calculatedAt: AT,
      recalculationPolicy: 'Recalculated from your current records every time it runs.',
      sufficiency: SUFFICIENCY,
      baseline: {
        startingPositionMinor: '3000000',
        incomeMinor: '0',
        expensesMinor: '1035626',
        endingPositionMinor: '1964374',
      },
      simulated: {
        startingPositionMinor: '3000000',
        incomeMinor: '0',
        expensesMinor: '976488',
        endingPositionMinor: '2023512',
      },
      differenceMinor: '59138',
      effects: [
        {
          index: 0,
          kind: 'category_spending',
          description: 'Spend less on Dining by 15%',
          status: 'applied',
          positionChangeMinor: '59138',
        },
      ],
      timeline: [
        { date: '2026-11-03', baselineMinor: '3000000', simulatedMinor: '3000000' },
        { date: '2026-12-03', baselineMinor: '1964374', simulatedMinor: '2023512' },
      ],
      goalImpacts: [],
      budgetImpacts: [],
      assumptions: ['The baseline is the cash-flow projection.'],
      limitations: ['A simulation only: nothing was recorded.'],
    };
    renderWithAuth(<ScenarioResult result={result} timeZone="Asia/Kolkata" aiAvailable={false} />);
    expect(screen.getByText('Simulation — nothing was changed')).toBeDefined();
    expect(screen.getByText('Spend less on Dining by 15%')).toBeDefined();
    const difference = screen.getByText(/Difference by/).nextElementSibling;
    expect(difference?.textContent).toBe('+₹591.38');
    expect(difference?.className).not.toMatch(/text-income|text-green/);
  });
});
