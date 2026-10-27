// @vitest-environment jsdom
import type {
  BudgetSummaryDto,
  DashboardCategoriesDto,
  DashboardOverviewDto,
  DashboardTrendsDto,
  ExpenseTransactionDto,
  SavingsGoalListDto,
  TransactionPageDto,
  UpcomingOccurrencesDto,
} from '@calmcash/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement, isValidElement, type ReactNode } from 'react';
import type * as Recharts from 'recharts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithAuth } from '@/testing/auth';

import { DashboardPage } from './dashboard-page';

// --- Mocks ---------------------------------------------------------------------------------------

const navigation = vi.hoisted(() => {
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    replace: vi.fn(),
    push: vi.fn(),
    current: (): URLSearchParams => search,
    set: (href: string): void => {
      search = new URLSearchParams(href.split('?')[1] ?? '');
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSearchParams: () =>
      useSyncExternalStore(navigation.subscribe, navigation.current, navigation.current),
    useRouter: () => ({
      replace: (href: string, options?: unknown) => {
        navigation.replace(href, options);
        navigation.set(href);
      },
      push: navigation.push,
    }),
  };
});

// jsdom has no layout: give charts a fixed size instead of measuring their container.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: ReactNode;
      height: number | string;
    }) =>
      isValidElement<{ width?: number; height?: number }>(children)
        ? cloneElement(children, { width: 640, height: typeof height === 'number' ? height : 280 })
        : null,
  };
});

const services = vi.hoisted(() => ({
  getDashboardOverview: vi.fn(),
  getDashboardTrends: vi.fn(),
  getDashboardCategories: vi.fn(),
}));
vi.mock('@/services/dashboard.service', () => services);

const transactionServices = vi.hoisted(() => ({ listTransactions: vi.fn() }));
vi.mock('@/services/transactions.service', () => transactionServices);

const planningServices = vi.hoisted(() => ({
  getBudgetSummary: vi.fn(),
  getUpcomingOccurrences: vi.fn(),
  listGoals: vi.fn(),
}));
vi.mock('@/services/budgets.service', () => ({
  getBudgetSummary: planningServices.getBudgetSummary,
}));
vi.mock('@/services/recurring.service', () => ({
  getUpcomingOccurrences: planningServices.getUpcomingOccurrences,
}));
vi.mock('@/services/goals.service', () => ({ listGoals: planningServices.listGoals }));

// --- Data ----------------------------------------------------------------------------------------

const PERIOD = {
  period: 'this-month',
  from: '2026-10-01',
  to: '2026-10-27',
  timeZone: 'Asia/Kolkata',
} as const;
const FOOD = '0193a000-0000-7000-8000-000000000101';

function overviewData(overrides: Partial<DashboardOverviewDto> = {}): DashboardOverviewDto {
  return {
    period: PERIOD,
    currency: 'INR',
    currencies: ['INR'],
    position: {
      currencies: [
        {
          currency: 'INR',
          assetsMinor: '20680700',
          liabilitiesMinor: '830000',
          assetAccounts: 2,
          liabilityAccounts: 1,
        },
      ],
    },
    accounts: { active: 3, archived: 0 },
    hasTransactions: true,
    cashFlow: {
      incomeMinor: '8500000',
      expenseMinor: '428300',
      netMinor: '8071700',
      incomeCount: 1,
      expenseCount: 5,
    },
    savingsRate: { status: 'available', basisPoints: '9496' },
    comparison: {
      status: 'available',
      from: '2026-09-01',
      to: '2026-09-27',
      income: {
        previousMinor: '8000000',
        changeMinor: '500000',
        changePercent: { status: 'available', basisPoints: '625' },
      },
      expense: {
        previousMinor: '100000',
        changeMinor: '328300',
        changePercent: { status: 'available', basisPoints: '32830' },
      },
      net: { previousMinor: '7900000', changeMinor: '171700' },
    },
    ...overrides,
  };
}

const trendsData: DashboardTrendsDto = {
  period: PERIOD,
  currency: 'INR',
  granularity: 'day',
  buckets: [
    {
      start: '2026-10-01',
      end: '2026-10-01',
      partial: false,
      incomeMinor: '8500000',
      expenseMinor: '0',
      netMinor: '8500000',
    },
    {
      start: '2026-10-02',
      end: '2026-10-02',
      partial: false,
      incomeMinor: '0',
      expenseMinor: '245000',
      netMinor: '-245000',
    },
  ],
};

const categoriesData: DashboardCategoriesDto = {
  period: PERIOD,
  currency: 'INR',
  totalExpenseMinor: '428300',
  expenseCount: 5,
  entries: [
    {
      kind: 'category',
      categoryId: FOOD,
      name: 'Food',
      archived: false,
      amountMinor: '345000',
      transactionCount: 4,
      shareBasisPoints: '8055',
    },
    { kind: 'uncategorized', amountMinor: '83300', transactionCount: 1, shareBasisPoints: '1945' },
  ],
};

const recentExpense: ExpenseTransactionDto = {
  id: '0193a000-0000-7000-8000-000000000301',
  userId: '0193a000-0000-7000-8000-000000000001',
  type: 'expense',
  accountId: '0193a000-0000-7000-8000-000000000201',
  amountMinor: '245000',
  currency: 'INR',
  description: 'Weekly groceries',
  merchant: 'FreshMart',
  tags: [],
  status: 'active',
  occurredAt: '2026-10-02T06:00:00.000Z',
  createdAt: '2026-10-02T06:00:00.000Z',
  updatedAt: '2026-10-02T06:00:00.000Z',
};

const recentPage: TransactionPageDto = {
  items: [
    {
      transaction: recentExpense,
      account: {
        id: recentExpense.accountId,
        name: 'HDFC',
        type: 'bank',
        currency: 'INR',
        status: 'active',
      },
      category: { id: FOOD, name: 'Groceries', kind: 'expense' },
    },
  ],
  pagination: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1 },
};

const NO_BUDGETS: BudgetSummaryDto = {
  date: '2026-10-27',
  currencies: [],
  statusCounts: {
    on_track: 0,
    approaching_limit: 0,
    limit_reached: 0,
    over_budget: 0,
    not_applicable: 0,
  },
  totals: [],
  highlights: [],
};

const NOTHING_UPCOMING: UpcomingOccurrencesDto = {
  today: '2026-10-27',
  from: '2026-10-27',
  to: '2026-11-10',
  items: [],
  pendingTotals: [],
  overdueCount: 0,
  truncated: false,
};

const NO_GOALS: SavingsGoalListDto = { today: '2026-10-27', goals: [] };

function respond(overview: DashboardOverviewDto = overviewData()): void {
  planningServices.getBudgetSummary.mockResolvedValue(NO_BUDGETS);
  planningServices.getUpcomingOccurrences.mockResolvedValue(NOTHING_UPCOMING);
  planningServices.listGoals.mockResolvedValue(NO_GOALS);
  services.getDashboardOverview.mockResolvedValue(overview);
  services.getDashboardTrends.mockResolvedValue(trendsData);
  services.getDashboardCategories.mockResolvedValue(categoriesData);
  transactionServices.listTransactions.mockResolvedValue(recentPage);
}

beforeEach(() => {
  for (const mock of [
    ...Object.values(services),
    ...Object.values(transactionServices),
    ...Object.values(planningServices),
    navigation.replace,
    navigation.push,
  ]) {
    mock.mockReset();
  }
  navigation.set('/dashboard');
});

// --- Tests ---------------------------------------------------------------------------------------

describe('DashboardPage', () => {
  it('shows the signed-in user’s live figures, never sample data', async () => {
    respond();
    renderWithAuth(<DashboardPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Asha' })).toBeDefined();
    const position = await screen.findByRole('region', { name: 'Where you stand' });
    expect(within(position).getByText('₹2,06,807.00')).toBeDefined();
    expect(within(position).getByText('₹8,300.00')).toBeDefined();
    expect(within(position).getByText('Money held')).toBeDefined();
    expect(within(position).getByText('Amount owed')).toBeDefined();

    const summary = screen.getByRole('region', { name: 'Cash flow for the period' });
    expect(summary.textContent).toContain('+₹85,000.00');
    expect(summary.textContent).toContain('−₹4,283.00');
    expect(summary.textContent).toContain('₹80,717.00');
    expect(summary.textContent).toContain('95.0%');
    expect(summary.textContent).toContain('+6.3% vs 1 Sept – 27 Sept 2026');

    expect(services.getDashboardOverview).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(services.getDashboardTrends).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(services.getDashboardCategories).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(screen.queryByText(/sample|design preview/i)).toBeNull();
  });

  it('lists recent transactions with links to their details', async () => {
    respond();
    renderWithAuth(<DashboardPage />);

    const recent = await screen.findByRole('list', { name: 'Recent transactions' });
    const link = within(recent).getByRole('link');
    expect(link.textContent).toContain('FreshMart');
    expect(link.textContent).toContain('Debit −₹2,450.00');
    expect(link.getAttribute('href')).toBe(`/transactions?transaction=${recentExpense.id}`);
    expect(screen.getByRole('link', { name: /View all/ }).getAttribute('href')).toBe(
      '/transactions',
    );
  });

  it('charts cash flow with a legend, an exact table, and currency-formatted tooltips', async () => {
    respond();
    renderWithAuth(<DashboardPage />);

    const chart = await screen.findByRole('region', { name: 'Money in and out' });
    expect(within(chart).getByRole('list', { name: 'Chart legend' }).textContent).toContain(
      'Money in',
    );
    const table = within(chart).getByRole('table', { name: 'Money in and out per day, INR' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('1 October 2026');
    expect(rows[1]?.textContent).toContain('₹85,000.00');
    expect(rows[2]?.textContent).toContain('₹2,450.00');

    // Keyboard users move through the buckets; the tooltip lists both series and the net.
    const surface = chart.querySelector('svg.recharts-surface');
    expect(surface).not.toBeNull();
    if (surface instanceof SVGElement) {
      act(() => {
        surface.focus();
      });
      fireEvent.keyDown(surface, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(chart.textContent).toContain('2 October 2026');
      });
      // Name then value in the markup (a description list); the value leads on screen.
      expect(chart.textContent).toContain('Money in₹0.00Money out₹2,450.00Net−₹2,450.00');
    }
  });

  it('breaks spending down by category and links each to its transactions', async () => {
    respond();
    renderWithAuth(<DashboardPage />);

    const spending = await screen.findByRole('region', { name: 'Where your money went' });
    const table = within(spending).getByRole('table', { name: 'Spending by category, INR' });
    expect(within(table).getByRole('link', { name: 'Food' }).getAttribute('href')).toBe(
      `/transactions?type=expense&categoryId=${FOOD}&from=2026-10-01&to=2026-10-27`,
    );
    expect(within(table).getByRole('link', { name: 'Uncategorised' }).getAttribute('href')).toBe(
      '/transactions?type=expense&from=2026-10-01&to=2026-10-27',
    );
    expect(table.textContent).toContain('80.6%');
  });

  it('welcomes a user without accounts with a first step instead of numbers', async () => {
    respond(
      overviewData({
        accounts: { active: 0, archived: 0 },
        position: { currencies: [] },
        hasTransactions: false,
      }),
    );
    renderWithAuth(<DashboardPage />);

    expect(
      await screen.findByRole('heading', { name: 'Add your first account to get started' }),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Add an account' }).getAttribute('href')).toBe(
      '/accounts',
    );
    expect(screen.queryByText('₹0.00')).toBeNull();
  });

  it('shows opening balances and explains what appears once transactions exist', async () => {
    respond(overviewData({ hasTransactions: false }));
    renderWithAuth(<DashboardPage />);

    expect(
      await screen.findByRole('heading', { name: 'Record a transaction to see your cash flow' }),
    ).toBeDefined();
    expect(screen.getByRole('region', { name: 'Where you stand' }).textContent).toContain(
      '₹2,06,807.00',
    );
    expect(screen.queryByRole('region', { name: 'Money in and out' })).toBeNull();
  });

  it('keeps working sections visible when one request fails', async () => {
    respond();
    services.getDashboardTrends.mockRejectedValueOnce(apiError('INTERNAL_ERROR', 'boom', 500));
    renderWithAuth(<DashboardPage />);

    expect(
      await screen.findByRole('heading', { name: 'The cash-flow chart could not be loaded' }),
    ).toBeDefined();
    expect(await screen.findByRole('table', { name: 'Spending by category, INR' })).toBeDefined();
    services.getDashboardTrends.mockResolvedValue(trendsData);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('table', { name: 'Money in and out per day, INR' }),
    ).toBeDefined();
  });

  it('keeps the period controls usable when the overview fails', async () => {
    respond();
    services.getDashboardOverview.mockRejectedValue(apiError('NETWORK_ERROR', 'offline', 0));
    renderWithAuth(<DashboardPage />);

    expect(
      await screen.findByRole('heading', { name: 'Your balances could not be loaded' }),
    ).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeDefined();
  });

  it('changes the period for every period figure, through the URL', async () => {
    respond();
    renderWithAuth(<DashboardPage />);
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Where you stand' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'last-month');

    expect(navigation.replace).toHaveBeenLastCalledWith('/dashboard?period=last-month', {
      scroll: false,
    });
    await waitFor(() => {
      expect(services.getDashboardOverview).toHaveBeenLastCalledWith(
        'period=last-month',
        expect.any(AbortSignal),
      );
      expect(services.getDashboardTrends).toHaveBeenLastCalledWith(
        'period=last-month',
        expect.any(AbortSignal),
      );
      expect(services.getDashboardCategories).toHaveBeenLastCalledWith(
        'period=last-month',
        expect.any(AbortSignal),
      );
    });
  });

  it('applies a custom range only when it is valid', async () => {
    respond();
    renderWithAuth(<DashboardPage />);
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Where you stand' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'custom');
    const form = screen.getByRole('form', { name: 'Custom range' });
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-03-31' } });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-03-01' } });
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(within(form).getByRole('alert').textContent).toContain('on or after the start date');
    expect(navigation.replace).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-03-31' } });
    await user.click(within(form).getByRole('button', { name: 'Apply' }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/dashboard?period=custom&from=2026-03-01&to=2026-03-31',
      { scroll: false },
    );
  });

  it('offers a currency choice only with several currencies, and requests one currency at a time', async () => {
    respond(overviewData({ currencies: ['INR', 'USD'] }));
    renderWithAuth(<DashboardPage />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Currency' }), 'USD');

    await waitFor(() => {
      for (const service of Object.values(services)) {
        expect(service).toHaveBeenLastCalledWith('currency=USD', expect.any(AbortSignal));
      }
    });
  });

  it('explains an unavailable savings rate instead of showing zero', async () => {
    respond(
      overviewData({
        cashFlow: {
          incomeMinor: '0',
          expenseMinor: '5000',
          netMinor: '-5000',
          incomeCount: 0,
          expenseCount: 1,
        },
        savingsRate: { status: 'unavailable', reason: 'no_income' },
        comparison: {
          status: 'unavailable',
          from: '2026-09-01',
          to: '2026-09-27',
          reason: 'no_previous_activity',
        },
      }),
    );
    renderWithAuth(<DashboardPage />);
    const user = userEvent.setup();

    const summary = await screen.findByRole('region', { name: 'Cash flow for the period' });
    expect(summary.textContent).toContain('Not available');
    expect(summary.textContent).toContain('Needs income in this period');
    expect(summary.textContent).toContain('no earlier period to compare with');

    await user.click(within(summary).getByRole('button', { name: 'What is savings rate?' }));
    expect(summary.textContent).toContain('Savings rate = (money in − money out) ÷ money in');
  });

  it('shows live planning previews and keeps them independent', async () => {
    respond();
    planningServices.getBudgetSummary.mockResolvedValue({
      ...NO_BUDGETS,
      currency: 'INR',
      currencies: ['INR'],
      statusCounts: { ...NO_BUDGETS.statusCounts, over_budget: 1 },
      totals: [
        {
          period: 'monthly',
          from: '2026-10-01',
          to: '2026-10-31',
          budgetCount: 1,
          scope: 'categories',
          limitMinor: '500000',
          spentMinor: '650000',
          remainingMinor: '-150000',
          used: { status: 'available', basisPoints: '13000' },
        },
      ],
    } satisfies BudgetSummaryDto);
    planningServices.listGoals.mockRejectedValue(apiError('INTERNAL_ERROR', 'boom', 500));
    renderWithAuth(<DashboardPage />);

    const budgets = await screen.findByRole('region', { name: 'Budgets' });
    await waitFor(() => {
      expect(budgets.textContent).toContain('₹1,500.00');
    });
    expect(budgets.textContent).toContain('Over');
    expect(budgets.textContent).toContain('1 over budget');
    const upcoming = screen.getByRole('region', { name: 'Coming up' });
    await waitFor(() => {
      expect(upcoming.textContent).toContain('Nothing due in the next 14 days');
    });
    expect(
      await screen.findByRole('heading', { name: 'Savings goals could not be loaded' }),
    ).toBeDefined();
    expect(screen.getByRole('region', { name: 'Where you stand' })).toBeDefined();
  });
});
