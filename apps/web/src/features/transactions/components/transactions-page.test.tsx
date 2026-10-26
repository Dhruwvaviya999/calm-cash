// @vitest-environment jsdom
import type {
  AccountDto,
  AccountWithBalanceDto,
  CategoryDto,
  CreateTransactionInput,
  ExpenseTransactionDto,
  TransactionListItemDto,
  TransactionPageDto,
  TransactionSummaryDto,
} from '@calmcash/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithAuth } from '@/testing/auth';

import { TransactionsPage } from './transactions-page';

// --- Mocks ---------------------------------------------------------------------------------------

const navigation = vi.hoisted(() => {
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    replace: vi.fn(),
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
      push: vi.fn(),
    }),
  };
});

const services = vi.hoisted(() => ({
  listTransactions: vi.fn(),
  getTransactionSummary: vi.fn(),
  getTransaction: vi.fn(),
  createTransaction:
    vi.fn<(input: CreateTransactionInput, key: string) => Promise<TransactionListItemDto>>(),
  updateTransaction: vi.fn(),
  voidTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
  bulkUpdateTransactions: vi.fn(),
  previewReconciliation: vi.fn(),
  reconcileBalance: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('@/services/transactions.service', () => services);

const accountServices = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('@/services/accounts.service', () => accountServices);

const categoryServices = vi.hoisted(() => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  archiveCategory: vi.fn(),
  restoreCategory: vi.fn(),
}));
vi.mock('@/services/categories.service', () => categoryServices);

// --- Data ----------------------------------------------------------------------------------------

const USER = '0193a000-0000-7000-8000-000000000001';
const AT = '2026-10-20T10:00:00.000Z';

function account(
  id: string,
  name: string,
  overrides: Partial<AccountDto> = {},
): AccountWithBalanceDto {
  return {
    account: {
      id,
      userId: USER,
      name,
      type: 'bank',
      classification: 'asset',
      currency: 'INR',
      openingBalanceMinor: '5000000',
      openingBalanceDate: '2026-01-01',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
      ...overrides,
    },
    balance: { currentBalanceMinor: '5000000', countedTransactions: 1 },
    hasTransactions: true,
  };
}

const bank = account('0193a000-0000-7000-8000-000000000201', 'HDFC Salary');
const cash = account('0193a000-0000-7000-8000-000000000202', 'Wallet cash', { type: 'cash' });
const card: AccountWithBalanceDto = {
  ...account('0193a000-0000-7000-8000-000000000203', 'Rewards Card', {
    type: 'credit_card',
    classification: 'liability',
    openingBalanceMinor: '-1250000',
  }),
  balance: { currentBalanceMinor: '-1250000', amountOwedMinor: '1250000', countedTransactions: 0 },
};

function category(
  id: string,
  name: string,
  kind: CategoryDto['kind'],
  parentId?: string,
): CategoryDto {
  return {
    id,
    userId: USER,
    name,
    kind,
    status: 'active',
    ...(parentId === undefined ? {} : { parentId }),
    createdAt: AT,
    updatedAt: AT,
  };
}

const food = category('0193a000-0000-7000-8000-000000000101', 'Food', 'expense');
const restaurants = category(
  '0193a000-0000-7000-8000-000000000102',
  'Restaurants',
  'expense',
  food.id,
);
const groceries = category('0193a000-0000-7000-8000-000000000103', 'Groceries', 'expense');
const salary = category('0193a000-0000-7000-8000-000000000104', 'Salary', 'income');

const groceriesTransaction: ExpenseTransactionDto = {
  id: '0193a000-0000-7000-8000-000000000301',
  userId: USER,
  type: 'expense',
  accountId: bank.account.id,
  amountMinor: '245000',
  currency: 'INR',
  description: 'Weekly groceries',
  merchant: 'FreshMart',
  categoryId: groceries.id,
  paymentMethod: 'upi',
  tags: ['family'],
  status: 'active',
  occurredAt: AT,
  createdAt: AT,
  updatedAt: AT,
};

const groceriesItem: TransactionListItemDto = {
  transaction: groceriesTransaction,
  account: {
    id: bank.account.id,
    name: 'HDFC Salary',
    type: 'bank',
    currency: 'INR',
    status: 'active',
  },
  category: { id: groceries.id, name: 'Groceries', kind: 'expense' },
};

function page(
  items: TransactionListItemDto[],
  totalItems = items.length,
  pageNumber = 1,
): TransactionPageDto {
  return {
    items,
    pagination: {
      page: pageNumber,
      pageSize: 25,
      totalItems,
      totalPages: Math.ceil(totalItems / 25),
    },
  };
}

const summary: TransactionSummaryDto = {
  currencies: [
    {
      currency: 'INR',
      incomeMinor: '0',
      expenseMinor: '245000',
      netMinor: '-245000',
      incomeCount: 0,
      expenseCount: 1,
    },
  ],
};

function respond(
  items: TransactionListItemDto[] = [groceriesItem],
  accounts = [bank, cash, card],
): void {
  services.listTransactions.mockResolvedValue(page(items));
  services.getTransactionSummary.mockResolvedValue(
    items.length === 0 ? { currencies: [] } : summary,
  );
  services.listTags.mockResolvedValue({ tags: [{ tag: 'family', count: 1 }] });
  accountServices.listAccounts.mockResolvedValue({ accounts });
  categoryServices.listCategories.mockResolvedValue({
    categories: [food, restaurants, groceries, salary],
  });
}

beforeEach(() => {
  for (const mock of [
    ...Object.values(services),
    ...Object.values(accountServices),
    ...Object.values(categoryServices),
    navigation.replace,
  ]) {
    mock.mockReset();
  }
  navigation.set('/transactions');
});

async function openAddForm(): Promise<HTMLElement> {
  await screen.findByText('FreshMart', { selector: 'button' });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Add transaction' }));
  return screen.findByRole('form', { name: 'Add a transaction' });
}

// --- Tests ---------------------------------------------------------------------------------------

describe('TransactionsPage', () => {
  it('loads real transactions and totals from the API, as a table and as phone rows', async () => {
    respond();
    renderWithAuth(<TransactionsPage />);

    expect(screen.getByRole('status').textContent).toContain('Loading your transactions');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('button', { name: 'FreshMart' })).toBeDefined();
    expect(within(table).getByText('UPI')).toBeDefined();
    const row = within(table).getAllByRole('row')[1];
    expect(row?.textContent).toContain('Debit −₹2,450.00');
    expect(row?.textContent).toContain('Groceries');
    const rows = screen.getByRole('list', { name: 'Transactions' });
    expect(within(rows).getByRole('button', { name: 'Details of FreshMart' })).toBeDefined();

    const totals = screen.getByRole('region', { name: 'Money in and out' });
    expect(within(totals).getByText('Money out')).toBeDefined();
    expect(within(totals).getByText(/All time/)).toBeDefined();
    expect(services.listTransactions).toHaveBeenCalledWith(
      'sort=newest&page=1&pageSize=25',
      expect.any(AbortSignal),
    );
    expect(services.getTransactionSummary).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it('distinguishes a first visit, no results, no accounts, and an error', async () => {
    respond([]);
    const first = renderWithAuth(<TransactionsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Record your first transaction' }),
    ).toBeDefined();
    first.unmount();

    respond([], []);
    const noAccounts = renderWithAuth(<TransactionsPage />);
    expect(await screen.findByRole('heading', { name: 'Add an account first' })).toBeDefined();
    noAccounts.unmount();

    respond([]);
    navigation.set('/transactions?q=nothing&type=income');
    const filtered = renderWithAuth(<TransactionsPage />);
    expect(await screen.findByRole('heading', { name: 'No transactions match' })).toBeDefined();
    expect(services.listTransactions).toHaveBeenLastCalledWith(
      'q=nothing&type=income&sort=newest&page=1&pageSize=25',
      expect.any(AbortSignal),
    );
    filtered.unmount();

    navigation.set('/transactions');
    respond();
    services.listTransactions.mockRejectedValueOnce(apiError('NETWORK_ERROR', 'offline', 0));
    renderWithAuth(<TransactionsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Your transactions could not be loaded' }),
    ).toBeDefined();
    // Never a made-up list in place of the real one.
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeDefined();
  });

  it('shows the fields of each type and offers the balance correction from the type picker', async () => {
    respond();
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    const form = await openAddForm();

    expect(within(form).getByLabelText('Paid to')).toBeDefined();
    expect(within(form).getByLabelText('Category')).toBeDefined();
    expect(within(form).queryByLabelText('To account')).toBeNull();

    await user.click(within(form).getByRole('radio', { name: /Income/ }));
    expect(within(form).getByLabelText('Received from')).toBeDefined();
    expect(within(form).getByLabelText('Received into')).toBeDefined();

    // Problems found for one type are not carried over to another.
    await user.click(within(form).getByRole('button', { name: 'Add income' }));
    expect(within(form).getByText('Describe what this was for.')).toBeDefined();
    await user.click(within(form).getByRole('radio', { name: /Transfer/ }));
    expect(within(form).queryByText('Describe what this was for.')).toBeNull();
    expect(within(form).queryByLabelText('Category')).toBeNull();
    expect(within(form).queryByLabelText('Paid to')).toBeNull();
    await user.selectOptions(within(form).getByLabelText('From account'), bank.account.id);
    const destinations = within(within(form).getByLabelText('To account')).getAllByRole('option');
    // The source account is never offered as the destination.
    const labels = destinations.map((option) => option.textContent);
    expect(labels.some((label) => label.includes('HDFC Salary'))).toBe(false);
    expect(labels.some((label) => label.includes('Wallet cash'))).toBe(true);

    await user.click(within(form).getByRole('radio', { name: /Adjust balance/ }));
    expect(await screen.findByRole('form', { name: 'Correct a balance' })).toBeDefined();
  });

  it('validates before sending and never records a half-filled transaction', async () => {
    respond();
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    const form = await openAddForm();

    await user.selectOptions(within(form).getByLabelText('Paid from'), bank.account.id);
    await user.type(within(form).getByLabelText('Amount'), '10.999');
    await user.click(within(form).getByRole('button', { name: 'Add expense' }));

    expect(within(form).getByText('INR amounts have at most 2 decimal places.')).toBeDefined();
    expect(within(form).getByText('Choose a category.')).toBeDefined();
    expect(within(form).getByText('Describe what this was for.')).toBeDefined();
    expect(services.createTransaction).not.toHaveBeenCalled();
  });

  it('records an expense exactly, once, and refreshes the history and balances', async () => {
    respond();
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    const form = await openAddForm();

    await user.type(within(form).getByLabelText('Amount'), '1,250.50');
    await user.type(within(form).getByLabelText('Paid to'), 'Cafe Mocha');
    await user.type(within(form).getByLabelText('What was it for?'), 'Team coffee');
    await user.selectOptions(within(form).getByLabelText('Category'), restaurants.id);
    await user.selectOptions(within(form).getByLabelText('Paid from'), cash.account.id);

    services.createTransaction.mockRejectedValueOnce(apiError('NETWORK_ERROR', 'offline', 0));
    const submit = within(form).getByRole('button', { name: 'Add expense' });
    await user.click(submit);
    // A failed attempt keeps everything typed, so it can simply be retried.
    expect(await within(form).findByText(/could not be reached/)).toBeDefined();
    expect(within(form).getByLabelText('Paid to')).toHaveProperty('value', 'Cafe Mocha');

    services.createTransaction.mockResolvedValueOnce({
      ...groceriesItem,
      transaction: { ...groceriesTransaction, merchant: 'Cafe Mocha' },
    });
    await user.click(within(form).getByRole('button', { name: 'Add expense' }));

    expect(services.createTransaction).toHaveBeenCalledTimes(2);
    const [firstInput, firstKey] = services.createTransaction.mock.calls[0] ?? [undefined, ''];
    const [secondInput, secondKey] = services.createTransaction.mock.calls[1] ?? [undefined, ''];
    expect(firstInput).toMatchObject({
      type: 'expense',
      accountId: cash.account.id,
      amountMinor: '125050',
      merchant: 'Cafe Mocha',
      description: 'Team coffee',
      categoryId: restaurants.id,
    });
    expect(secondInput).toEqual(firstInput);
    // The retry reuses the key, so the API can never record the expense twice.
    expect(typeof firstKey).toBe('string');
    expect(secondKey).toBe(firstKey);

    expect((await screen.findByRole('status')).textContent).toContain('Cafe Mocha was recorded.');
    await waitFor(() => {
      expect(services.listTransactions).toHaveBeenCalledTimes(2);
      expect(accountServices.listAccounts).toHaveBeenCalledTimes(2);
    });
  });

  it('combines search and filters in the URL, shows them, and clears them', async () => {
    respond();
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Search transactions' }), 'fresh');
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenLastCalledWith('/transactions?q=fresh', {
        scroll: false,
      });
    });

    // The search already counts as one active filter.
    await user.click(screen.getByRole('button', { name: 'Filters, 1 active' }));
    const filters = await screen.findByRole('form', { name: 'Filter transactions' });
    await user.click(within(filters).getByRole('radio', { name: 'Expense' }));
    await user.selectOptions(within(filters).getByLabelText('Account'), bank.account.id);
    await user.type(within(filters).getByLabelText('At least'), '1,000');
    await user.click(within(filters).getByRole('button', { name: 'Show results' }));

    await waitFor(() => {
      expect(services.listTransactions).toHaveBeenLastCalledWith(
        `q=fresh&type=expense&accountId=${bank.account.id}&minAmount=1000&sort=newest&page=1&pageSize=25`,
        expect.any(AbortSignal),
      );
    });
    expect(services.getTransactionSummary).toHaveBeenLastCalledWith(
      `q=fresh&type=expense&accountId=${bank.account.id}&minAmount=1000`,
      expect.any(AbortSignal),
    );
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getByText('Expense')).toBeDefined();
    expect(within(chips).getByText('HDFC Salary')).toBeDefined();
    expect(within(chips).getByText('At least 1000')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Filters, 4 active' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(navigation.replace).toHaveBeenLastCalledWith('/transactions', { scroll: false });
  });

  it('pages through results and starts from page one when the order changes', async () => {
    respond();
    services.listTransactions.mockResolvedValue(page([groceriesItem], 60));
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();

    expect(await screen.findByText('Page 1 of 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(navigation.replace).toHaveBeenLastCalledWith('/transactions?page=2', { scroll: false });

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort transactions' }),
      'largest',
    );
    expect(navigation.replace).toHaveBeenLastCalledWith('/transactions?sort=largest', {
      scroll: false,
    });
  });

  it('asks before voiding, and voids only after confirmation', async () => {
    respond();
    services.voidTransaction.mockResolvedValue({
      ...groceriesItem,
      transaction: { ...groceriesItem.transaction, status: 'voided', voidedAt: AT },
    });
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    const table = await screen.findByRole('table');

    await user.click(within(table).getByRole('button', { name: 'Actions for FreshMart' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Void' }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Void FreshMart?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    expect(services.voidTransaction).not.toHaveBeenCalled();

    await user.click(within(table).getByRole('button', { name: 'Actions for FreshMart' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Void' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Void FreshMart?' });
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Recorded twice');
    await user.click(within(dialog).getByRole('button', { name: 'Void transaction' }));

    expect(services.voidTransaction).toHaveBeenCalledWith(
      groceriesItem.transaction.id,
      'Recorded twice',
    );
    expect((await screen.findByRole('status')).textContent).toContain('FreshMart was voided');
  });

  it('opens details and edits only what changed', async () => {
    respond();
    services.updateTransaction.mockResolvedValue(groceriesItem);
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    const table = await screen.findByRole('table');

    await user.click(within(table).getByRole('button', { name: 'FreshMart' }));
    const sheet = await screen.findByRole('dialog', { name: 'FreshMart' });
    expect(within(sheet).getByText('Weekly groceries')).toBeDefined();
    expect(within(sheet).getByText('family')).toBeDefined();
    await user.click(within(sheet).getByRole('button', { name: 'Edit' }));

    const form = await screen.findByRole('form', { name: 'Edit transaction' });
    const amount = within(form).getByLabelText('Amount');
    expect(amount).toHaveProperty('value', '2450.00');
    await user.clear(amount);
    await user.type(amount, '2500');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(services.updateTransaction).toHaveBeenCalledWith(groceriesItem.transaction.id, {
      amountMinor: '250000',
    });
  });

  it('reviews a card correction in terms of the amount owed before recording it', async () => {
    respond();
    services.previewReconciliation.mockResolvedValue({
      accountId: card.account.id,
      currency: 'INR',
      asOf: AT,
      observedBalanceMinor: '-1300000',
      before: card.balance,
      after: {
        currentBalanceMinor: '-1300000',
        amountOwedMinor: '1300000',
        countedTransactions: 1,
      },
      adjustment: { direction: 'decrease', amountMinor: '50000' },
    });
    services.reconcileBalance.mockResolvedValue({
      ...groceriesItem,
      account: { ...groceriesItem.account, name: 'Rewards Card' },
    });
    navigation.set(`/transactions?reconcile=${card.account.id}`);
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();

    const form = await screen.findByRole('form', { name: 'Correct a balance' });
    await user.type(
      within(form).getByLabelText('Amount you owe, per your statement or app'),
      '13000',
    );
    await user.type(within(form).getByLabelText('Reason'), 'Statement');
    await user.click(within(form).getByRole('button', { name: 'Review adjustment' }));

    const review = await screen.findByRole('region', { name: 'Review the adjustment' });
    expect(within(review).getByText(/Amount owed goes up/)).toBeDefined();
    expect(services.previewReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: card.account.id, observedBalanceMinor: '-1300000' }),
    );
    expect(services.reconcileBalance).not.toHaveBeenCalled();

    await user.click(within(review).getByRole('button', { name: 'Record adjustment' }));
    expect(services.reconcileBalance).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Statement', expectedAdjustmentMinor: '-50000' }),
      expect.any(String),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Rewards Card was corrected');
  });

  it('applies a bulk category change to the selected transactions', async () => {
    respond();
    services.bulkUpdateTransactions.mockResolvedValue({
      action: 'set_category',
      requested: 1,
      changed: 1,
    });
    renderWithAuth(<TransactionsPage />);
    const user = userEvent.setup();
    const table = await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(within(table).getByRole('checkbox', { name: 'Select FreshMart' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(toolbar).getByText('1 selected')).toBeDefined();
    await user.click(within(toolbar).getByRole('button', { name: /Categorise/ }));
    const form = await screen.findByRole('form', { name: 'Categorise transactions' });
    await user.selectOptions(within(form).getByLabelText('Category'), food.id);
    await act(async () => {
      await user.click(within(form).getByRole('button', { name: 'Apply to 1' }));
    });

    expect(services.bulkUpdateTransactions).toHaveBeenCalledWith({
      action: 'set_category',
      transactionIds: [groceriesItem.transaction.id],
      categoryId: food.id,
    });
    expect((await screen.findByRole('status')).textContent).toContain(
      '1 of 1 transactions changed.',
    );
  });
});
