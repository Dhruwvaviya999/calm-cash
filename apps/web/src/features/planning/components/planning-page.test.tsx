// @vitest-environment jsdom
import type {
  AccountListDto,
  BudgetListDto,
  BudgetSummaryDto,
  BudgetWithProgressDto,
  CategoryListDto,
  RecordedOccurrenceDto,
  RecurringScheduleDto,
  RecurringScheduleListDto,
  SavingsGoalListDto,
  SubscriptionListDto,
  SubscriptionSummaryDto,
  UpcomingOccurrencesDto,
} from '@calmcash/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '@/testing/auth';

import { PlanningPage } from './planning-page';

// --- Mocks ---------------------------------------------------------------------------------------

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.search,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/budgets',
}));

const budgets = vi.hoisted(() => ({
  listBudgets: vi.fn(),
  getBudgetSummary: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  archiveBudget: vi.fn(),
  restoreBudget: vi.fn(),
  getBudget: vi.fn(),
}));
vi.mock('@/services/budgets.service', () => budgets);

const categories = vi.hoisted(() => ({ listCategories: vi.fn() }));
vi.mock('@/services/categories.service', () => categories);

const accounts = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('@/services/accounts.service', () => accounts);

const recurring = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  getUpcomingOccurrences: vi.fn(),
  getSchedule: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  changeSchedule: vi.fn(),
  endSchedule: vi.fn(),
  recordOccurrence: vi.fn(),
  skipOccurrence: vi.fn(),
  postponeOccurrence: vi.fn(),
}));
vi.mock('@/services/recurring.service', () => recurring);

const subscriptions = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  getSubscriptionSummary: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  changeSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
}));
vi.mock('@/services/subscriptions.service', () => subscriptions);

const goals = vi.hoisted(() => ({
  listGoals: vi.fn(),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  addGoalContribution: vi.fn(),
  changeGoal: vi.fn(),
}));
vi.mock('@/services/goals.service', () => goals);

const transactions = vi.hoisted(() => ({ listTransactions: vi.fn() }));
vi.mock('@/services/transactions.service', () => transactions);

// --- Data ----------------------------------------------------------------------------------------

const USER = '0193a000-0000-7000-8000-000000000001';
const FOOD = '0193a000-0000-7000-8000-000000000101';
const RENT = '0193a000-0000-7000-8000-000000000102';
const BANK = '0193a000-0000-7000-8000-000000000201';
const AUDIT = { createdAt: '2026-10-01T04:30:00.000Z', updatedAt: '2026-10-01T04:30:00.000Z' };

const categoryList: CategoryListDto = {
  categories: [
    { id: FOOD, userId: USER, name: 'Food', kind: 'expense', status: 'active', ...AUDIT },
    { id: RENT, userId: USER, name: 'Rent', kind: 'expense', status: 'active', ...AUDIT },
  ],
};

const accountList: AccountListDto = {
  accounts: [
    {
      account: {
        id: BANK,
        userId: USER,
        name: 'HDFC Salary',
        type: 'bank',
        classification: 'asset',
        currency: 'INR',
        openingBalanceMinor: '10000000',
        openingBalanceDate: '2026-01-01',
        status: 'active',
        ...AUDIT,
      },
      balance: {
        currentBalanceMinor: '10000000',
        countedTransactions: 0,
      },
      hasTransactions: false,
    },
  ],
} satisfies AccountListDto;

const overBudget: BudgetWithProgressDto = {
  budget: {
    id: '0193a000-0000-7000-8000-000000000401',
    userId: USER,
    name: 'Food',
    categoryId: FOOD,
    limitMinor: '1200000',
    currency: 'INR',
    period: 'monthly',
    startDate: '2026-10-01',
    alertThresholdsBp: [8000],
    status: 'active',
    ...AUDIT,
  },
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

const summary: BudgetSummaryDto = {
  date: '2026-10-27',
  currency: 'INR',
  currencies: ['INR'],
  statusCounts: {
    on_track: 0,
    approaching_limit: 0,
    limit_reached: 0,
    over_budget: 1,
    not_applicable: 0,
  },
  totals: [
    {
      period: 'monthly',
      from: '2026-10-01',
      to: '2026-10-31',
      budgetCount: 1,
      scope: 'categories',
      limitMinor: '1200000',
      spentMinor: '1380000',
      remainingMinor: '-180000',
      used: { status: 'available', basisPoints: '11500' },
    },
  ],
  highlights: [overBudget],
};

const rent: RecurringScheduleDto = {
  id: '0193a000-0000-7000-8000-000000000501',
  userId: USER,
  name: 'Rent',
  type: 'expense',
  amountMinor: '2500000',
  currency: 'INR',
  accountId: BANK,
  categoryId: RENT,
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-10-01',
  status: 'active',
  nextOccurrenceDate: '2026-10-01',
  isSubscription: false,
  ...AUDIT,
};

const upcoming: UpcomingOccurrencesDto = {
  today: '2026-10-27',
  from: '2026-10-27',
  to: '2026-11-26',
  items: [
    {
      occurrence: {
        scheduleId: rent.id,
        scheduledDate: '2026-10-01',
        dueDate: '2026-10-01',
        status: 'overdue',
        postponed: false,
        dueSoon: false,
        amountMinor: '2500000',
        currency: 'INR',
      },
      schedule: rent,
    },
  ],
  pendingTotals: [
    {
      currency: 'INR',
      expectedIncomeMinor: '0',
      expectedExpenseMinor: '2500000',
      incomeCount: 0,
      expenseCount: 1,
    },
  ],
  overdueCount: 1,
  truncated: false,
};

const scheduleList: RecurringScheduleListDto = {
  today: '2026-10-27',
  schedules: [{ schedule: rent }],
};

function show(section: string): void {
  navigation.search = new URLSearchParams(section === '' ? '' : `section=${section}`);
}

beforeEach(() => {
  for (const group of [
    budgets,
    categories,
    accounts,
    recurring,
    subscriptions,
    goals,
    transactions,
  ]) {
    for (const mock of Object.values(group)) mock.mockReset();
  }
  budgets.listBudgets.mockResolvedValue({
    date: '2026-10-27',
    budgets: [overBudget],
  } satisfies BudgetListDto);
  budgets.getBudgetSummary.mockResolvedValue(summary);
  categories.listCategories.mockResolvedValue(categoryList);
  accounts.listAccounts.mockResolvedValue(accountList);
  recurring.getUpcomingOccurrences.mockResolvedValue(upcoming);
  recurring.listSchedules.mockResolvedValue(scheduleList);
  show('');
});

// --- Tests ---------------------------------------------------------------------------------------

describe('PlanningPage › budgets', () => {
  it('shows live budget figures with the overspend visible', async () => {
    renderWithAuth(<PlanningPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Budgets & planning' })).toBeDefined();
    const card = await screen.findByRole('heading', { level: 3, name: 'Food' });
    const region = card.closest('[data-slot="card"]');
    expect(region?.textContent).toContain('Over budget');
    expect(region?.textContent).toContain('₹1,800.00 over');
    expect(region?.textContent).toContain('115.0%');
    expect(
      screen.getByRole('progressbar', { name: 'Food budget used' }).getAttribute('aria-valuetext'),
    ).toBe('115.0% of the limit used');
    expect(screen.getByRole('list', { name: 'Budgets by status' }).textContent).toContain(
      '1 over budget',
    );
    if (!(region instanceof HTMLElement)) throw new Error('Budget card not found.');
    const link = within(region).getByRole('link', { name: /Expenses/ });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      type: 'expense',
      currency: 'INR',
      from: '2026-10-01',
      to: '2026-10-31',
      categoryId: FOOD,
    });
  });

  it('opens the budget a notification links to, and explains when it is gone', async () => {
    transactions.listTransactions.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 8, totalItems: 0, totalPages: 0 },
    });
    navigation.search = new URLSearchParams(`budget=${overBudget.budget.id}`);
    const { unmount } = renderWithAuth(<PlanningPage />);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getAllByText('Food').length).toBeGreaterThan(0);
    unmount();

    // An archived or deleted budget: a calm explanation instead of a broken page.
    navigation.search = new URLSearchParams('budget=0193a000-0000-7000-8000-00000000dead');
    renderWithAuth(<PlanningPage />);
    expect(await screen.findByText('That budget is not in this list')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('validates the create form and sends exact minor units', async () => {
    budgets.createBudget.mockResolvedValue(overBudget);
    renderWithAuth(<PlanningPage />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 3, name: 'Food' });
    await user.click(screen.getByRole('button', { name: 'Create budget' }));
    const form = await screen.findByRole('form', { name: 'Create a budget' });

    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    expect(budgets.createBudget).not.toHaveBeenCalled();
    expect(within(form).getByText('Choose a category, or budget for all spending.')).toBeDefined();

    await user.selectOptions(within(form).getByLabelText('Category'), FOOD);
    await user.type(within(form).getByLabelText('Limit'), '12,000.5');
    await user.click(within(form).getByRole('button', { name: 'Create budget' }));
    await waitFor(() => {
      expect(budgets.createBudget).toHaveBeenCalledTimes(1);
    });
    expect(budgets.createBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Food',
        categoryId: FOOD,
        limitMinor: '1200050',
        currency: 'INR',
        period: 'monthly',
        alertThresholdsBp: [8000],
      }),
    );
  });

  it('offers a first budget when there are none, without sample data', async () => {
    budgets.listBudgets.mockResolvedValue({ date: '2026-10-27', budgets: [] });
    budgets.getBudgetSummary.mockResolvedValue({
      ...summary,
      currency: undefined,
      currencies: [],
      totals: [],
      highlights: [],
    });
    renderWithAuth(<PlanningPage />);
    expect(await screen.findByRole('heading', { name: 'Create your first budget' })).toBeDefined();
    expect(document.body.textContent).not.toContain('Sample');
  });
});

describe('PlanningPage › recurring', () => {
  it('records an overdue payment as one real transaction', async () => {
    show('recurring');
    let resolve: (value: RecordedOccurrenceDto) => void = () => undefined;
    recurring.recordOccurrence.mockReturnValue(
      new Promise<RecordedOccurrenceDto>((done) => {
        resolve = done;
      }),
    );
    renderWithAuth(<PlanningPage />);
    const user = userEvent.setup();

    const overdue = await screen.findByRole('list', { name: 'Overdue payments' });
    expect(overdue.textContent).toContain('Expected');
    expect(overdue.textContent).toContain('Overdue');
    await user.click(within(overdue).getByRole('button', { name: 'Record Rent' }));

    const form = await screen.findByRole('form', { name: 'Record Rent' });
    expect(form.textContent).toContain('This records real money');
    await waitFor(() => {
      const select = within(form).getByLabelText('Account');
      expect(select instanceof HTMLSelectElement ? select.value : '').toBe(BANK);
    });
    const submit = within(form).getByRole('button', { name: 'Record payment' });
    await user.click(submit);
    await user.click(submit);
    expect(recurring.recordOccurrence).toHaveBeenCalledTimes(1);
    expect(recurring.recordOccurrence).toHaveBeenCalledWith(
      rent.id,
      '2026-10-01',
      expect.objectContaining({ accountId: BANK, categoryId: RENT, amountMinor: '2500000' }),
    );
    const [overdueRent] = upcoming.items;
    if (overdueRent === undefined) throw new Error('Missing fixture.');
    resolve({
      occurrence: { ...overdueRent.occurrence, status: 'recorded' },
      schedule: { schedule: rent },
      transaction: {
        transaction: {
          id: '0193a000-0000-7000-8000-000000000901',
          userId: USER,
          accountId: BANK,
          type: 'expense',
          amountMinor: '2500000',
          currency: 'INR',
          description: 'Rent',
          categoryId: RENT,
          tags: [],
          status: 'active',
          occurredAt: '2026-10-01T06:30:00.000Z',
          ...AUDIT,
        },
        account: { id: BANK, name: 'HDFC Salary', type: 'bank', currency: 'INR', status: 'active' },
      },
    });
    expect(await screen.findByText(/Rent was recorded/)).toBeDefined();
  });

  it('shows the month calendar with accessible day labels', async () => {
    show('recurring');
    renderWithAuth(<PlanningPage />);
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Overdue payments' });
    await user.click(screen.getByRole('radio', { name: 'Calendar' }));
    const day = await screen.findByRole('button', {
      name: /1 October 2026, 1 payment, 1 expected, 1 overdue/,
    });
    expect(day).toBeDefined();
  });
});

describe('PlanningPage › subscriptions and goals', () => {
  it('labels subscription costs as estimates', async () => {
    show('subscriptions');
    subscriptions.listSubscriptions.mockResolvedValue({
      today: '2026-10-27',
      subscriptions: [
        {
          schedule: { ...rent, name: 'Netflix', amountMinor: '49900', isSubscription: true },
          status: 'active',
          nextTwelveMonths: {
            from: '2026-10-27',
            to: '2027-10-26',
            occurrences: 12,
            amountMinor: '598800',
          },
        },
      ],
    } satisfies SubscriptionListDto);
    subscriptions.getSubscriptionSummary.mockResolvedValue({
      today: '2026-10-27',
      currencies: [
        {
          currency: 'INR',
          activeCount: 1,
          overdueCount: 0,
          overdueMinor: '0',
          next30Days: {
            from: '2026-10-27',
            to: '2026-11-25',
            occurrences: 1,
            amountMinor: '49900',
          },
          next12Months: {
            from: '2026-10-27',
            to: '2027-10-26',
            occurrences: 12,
            amountMinor: '598800',
          },
        },
      ],
    } satisfies SubscriptionSummaryDto);
    renderWithAuth(<PlanningPage />);
    expect(await screen.findByRole('heading', { level: 3, name: 'Netflix' })).toBeDefined();
    expect(document.body.textContent).toContain('Estimated next 12 months');
    expect(document.body.textContent).toContain('₹5,988.00');
    expect(document.body.textContent).toContain('Not money already spent');
  });

  it('shows goal progress beyond the target as it is', async () => {
    show('goals');
    goals.listGoals.mockResolvedValue({
      today: '2026-10-27',
      goals: [
        {
          goal: {
            id: '0193a000-0000-7000-8000-000000000601',
            userId: USER,
            name: 'Holiday',
            targetMinor: '10000000',
            currency: 'INR',
            status: 'active',
            ...AUDIT,
          },
          progress: {
            savedMinor: '11000000',
            remainingMinor: '-1000000',
            percent: { status: 'available', basisPoints: '11000' },
            reached: true,
            contributionCount: 2,
          },
        },
      ],
    } satisfies SavingsGoalListDto);
    renderWithAuth(<PlanningPage />);
    expect(await screen.findByRole('heading', { level: 3, name: 'Holiday' })).toBeDefined();
    expect(document.body.textContent).toContain('110.0%');
    expect(document.body.textContent).toContain('₹10,000.00 beyond the target');
  });
});
