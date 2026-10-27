import type { BudgetDto, BudgetWithProgressDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  budgetToFormValues,
  buildCreateBudgetInput,
  buildUpdateBudgetInput,
  emptyBudgetFormValues,
  parseAlerts,
} from './budget-form-model';
import {
  BUDGET_STATUS_PRESENTATION,
  budgetTransactionsHref,
  describeRatio,
  describeScope,
  meterPercent,
} from './budget-presentation';

const FOOD = '0193a000-0000-7000-8000-000000000101';

const budget: BudgetDto = {
  id: '0193a000-0000-7000-8000-000000000401',
  userId: '0193a000-0000-7000-8000-000000000001',
  name: 'Food',
  categoryId: FOOD,
  limitMinor: '1200000',
  currency: 'INR',
  period: 'monthly',
  startDate: '2026-10-01',
  alertThresholdsBp: [8000],
  status: 'active',
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-10-01T04:30:00.000Z',
};

describe('budget form model', () => {
  it('starts a simple monthly budget from the first of this month with an 80% alert', () => {
    const values = emptyBudgetFormValues('INR', 'Asia/Kolkata');
    expect(values.period).toBe('monthly');
    expect(values.startDate.endsWith('-01')).toBe(true);
    expect(values.alerts).toBe('80');
  });

  it('parses exact limits and alert percentages', () => {
    const built = buildCreateBudgetInput({
      ...emptyBudgetFormValues('INR', 'Asia/Kolkata'),
      name: 'Food',
      categoryId: FOOD,
      limit: '12,000.50',
      startDate: '2026-10-01',
      alerts: '50, 80%',
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input).toMatchObject({
        limitMinor: '1200050',
        categoryId: FOOD,
        alertThresholdsBp: [5000, 8000],
      });
    }
  });

  it('reports problems per field instead of rounding or guessing', () => {
    const built = buildCreateBudgetInput({
      ...emptyBudgetFormValues('INR', 'Asia/Kolkata'),
      name: '',
      limit: '10.005',
      alerts: '90, 80',
      period: 'custom',
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors.limit).toContain('decimal places');
      expect(built.errors.alerts).toBeDefined();
      expect(built.errors.categoryId).toBeDefined();
      expect(built.errors.name).toBeDefined();
      expect(built.errors.endDate).toBeDefined();
    }
    expect(parseAlerts('')).toEqual({ ok: true, value: [] });
    expect(parseAlerts('100').ok).toBe(false);
    expect(parseAlerts('abc').ok).toBe(false);
  });

  it('sends only what changed, and null to clear', () => {
    const values = budgetToFormValues(budget);
    expect(buildUpdateBudgetInput(budget, values)).toEqual({ ok: true, input: undefined });
    expect(buildUpdateBudgetInput(budget, { ...values, limit: '15000', scope: 'overall' })).toEqual(
      { ok: true, input: { limitMinor: '1500000', categoryId: null } },
    );
  });
});

describe('budget presentation', () => {
  const item: BudgetWithProgressDto = {
    budget,
    category: { id: FOOD, name: 'Food', kind: 'expense', status: 'active' },
    progress: {
      from: '2026-10-01',
      to: '2026-10-31',
      partial: false,
      timing: 'current',
      limitMinor: '1200000',
      spentMinor: '1380000',
      remainingMinor: '-180000',
      used: { status: 'available', basisPoints: '11500' },
      status: 'over_budget',
      reachedThresholdBp: 8000,
      transactionCount: 9,
    },
  };

  it('never caps overspending and never relies on colour alone', () => {
    expect(describeRatio(item.progress.used)).toBe('115.0%');
    expect(meterPercent(item.progress.used)).toBe(115);
    expect(describeRatio({ status: 'unavailable', reason: 'no_limit' })).toBe('—');
    expect(BUDGET_STATUS_PRESENTATION.over_budget.label).toBe('Over budget');
    expect(BUDGET_STATUS_PRESENTATION.approaching_limit.label).toBe('Close to limit');
  });

  it('links to exactly the expenses the budget counts', () => {
    expect(budgetTransactionsHref(item)).toEqual({
      pathname: '/transactions',
      query: {
        type: 'expense',
        currency: 'INR',
        from: '2026-10-01',
        to: '2026-10-31',
        categoryId: FOOD,
      },
    });
    const { categoryId: _categoryId, ...overall } = budget;
    const { category: _category, ...rest } = item;
    expect(budgetTransactionsHref({ ...rest, budget: overall }).query).not.toHaveProperty(
      'categoryId',
    );
    expect(describeScope(item)).toBe('Food and its subcategories');
  });
});
