// @vitest-environment jsdom
import type { AccountDto, AccountSummaryDto, AccountWithBalanceDto } from '@calmcash/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithAuth } from '@/testing/auth';

import { AccountsOverview } from './accounts-overview';

const services = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getAccountSummary: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  archiveAccount: vi.fn(),
  restoreAccount: vi.fn(),
}));
vi.mock('@/services/accounts.service', () => services);

const TIMESTAMP = '2026-10-01T04:30:00.000Z';

function account(overrides: Partial<AccountDto>): AccountDto {
  return {
    id: '0193a000-0000-7000-8000-000000000201',
    userId: '0193a000-0000-7000-8000-000000000001',
    name: 'HDFC Salary',
    type: 'bank',
    classification: 'asset',
    currency: 'INR',
    openingBalanceMinor: '5000000',
    openingBalanceDate: '2026-10-01',
    institution: 'HDFC Bank',
    status: 'active',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

const bank: AccountWithBalanceDto = {
  account: account({}),
  balance: { currentBalanceMinor: '5000000', countedTransactions: 0 },
  hasTransactions: false,
};

const card: AccountWithBalanceDto = {
  account: account({
    id: '0193a000-0000-7000-8000-000000000202',
    name: 'Rewards Card',
    type: 'credit_card',
    classification: 'liability',
    openingBalanceMinor: '-1250000',
    creditLimitMinor: '10000000',
  }),
  balance: {
    currentBalanceMinor: '-1250000',
    amountOwedMinor: '1250000',
    availableCreditMinor: '8750000',
    countedTransactions: 0,
  },
  hasTransactions: false,
};

const summary: AccountSummaryDto = {
  currencies: [
    {
      currency: 'INR',
      assetsMinor: '5000000',
      liabilitiesMinor: '1250000',
      assetAccounts: 1,
      liabilityAccounts: 1,
    },
  ],
};

function respondWith(accounts: AccountWithBalanceDto[], totals: AccountSummaryDto = summary): void {
  services.listAccounts.mockResolvedValue({ accounts });
  services.getAccountSummary.mockResolvedValue(totals);
}

beforeEach(() => {
  for (const mock of Object.values(services)) {
    mock.mockReset();
  }
});

describe('AccountsOverview', () => {
  it('shows a loading state, then live accounts grouped into money held and owed', async () => {
    respondWith([bank, card]);
    renderWithAuth(<AccountsOverview />);

    expect(screen.getByRole('status').textContent).toContain('Loading your accounts');
    const held = await screen.findByRole('region', { name: 'Money you hold' });
    const owed = screen.getByRole('region', { name: 'Money you owe' });

    expect(within(held).getByText('HDFC Salary')).toBeDefined();
    expect(within(held).getByText('Bank account · HDFC Bank · INR')).toBeDefined();
    expect(within(held).getByText('Balance')).toBeDefined();
    expect(within(owed).getByText('Rewards Card')).toBeDefined();
    expect(within(owed).getByText('Amount owed')).toBeDefined();
    expect(within(owed).queryByText('Balance')).toBeNull();
    expect(within(owed).getByText('₹87,500.00 available of ₹1,00,000.00')).toBeDefined();

    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('Money held')).toBeDefined();
    expect(within(totals).getByText('Amount owed')).toBeDefined();
    expect(services.listAccounts).toHaveBeenCalledWith('active', expect.any(AbortSignal));
  });

  it('welcomes a new user with a first-account call to action instead of sample data', async () => {
    respondWith([], { currencies: [] });
    renderWithAuth(<AccountsOverview />);

    expect(await screen.findByRole('heading', { name: 'Add your first account' })).toBeDefined();
    expect(screen.queryByText(/sample/i)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Totals' })).toBeNull();
  });

  it('offers a retry when the API is unavailable, without falling back to sample accounts', async () => {
    services.listAccounts.mockRejectedValueOnce(apiError('NETWORK_ERROR', 'offline', 0));
    services.getAccountSummary.mockResolvedValue(summary);
    renderWithAuth(<AccountsOverview />);

    expect(
      await screen.findByRole('heading', { name: 'Your accounts could not be loaded' }),
    ).toBeDefined();
    respondWith([bank]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('HDFC Salary')).toBeDefined();
  });

  it('adapts the form to the account type and validates before sending', async () => {
    respondWith([], { currencies: [] });
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add an account' }));
    const form = await screen.findByRole('form', { name: 'Add an account' });
    // Nothing but the type picker until a type is chosen.
    expect(within(form).queryByLabelText('Account name')).toBeNull();

    await user.click(within(form).getByRole('radio', { name: /Cash/ }));
    expect(within(form).getByLabelText('Cash on hand')).toBeDefined();
    expect(within(form).queryByLabelText(/Credit limit/)).toBeNull();
    // Cash has no bank or provider.
    expect(form.querySelector('input[name="institution"]')).toBeNull();

    await user.click(within(form).getByRole('radio', { name: /Credit card/ }));
    expect(within(form).getByLabelText('Amount you owe now')).toBeDefined();
    expect(within(form).getByLabelText('Credit limit (optional)')).toBeDefined();

    await user.type(within(form).getByLabelText('Amount you owe now'), '10.999');
    await user.click(within(form).getByRole('button', { name: 'Add account' }));

    expect(within(form).getByText('Enter a name for this account.')).toBeDefined();
    expect(within(form).getByText('INR amounts have at most 2 decimal places.')).toBeDefined();
    expect(services.createAccount).not.toHaveBeenCalled();
  });

  it('creates an account with exact minor units and refreshes the list', async () => {
    respondWith([], { currencies: [] });
    services.createAccount.mockResolvedValue(card);
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add an account' }));
    const form = await screen.findByRole('form', { name: 'Add an account' });
    await user.click(within(form).getByRole('radio', { name: /Credit card/ }));
    await user.type(within(form).getByLabelText('Account name'), 'Rewards Card');
    await user.type(within(form).getByLabelText('Amount you owe now'), '12,500');
    await user.type(within(form).getByLabelText('Credit limit (optional)'), '100000');

    respondWith([card]);
    const submit = within(form).getByRole('button', { name: 'Add account' });
    await user.click(submit);

    expect(services.createAccount).toHaveBeenCalledOnce();
    expect(services.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Rewards Card',
        type: 'credit_card',
        currency: 'INR',
        openingBalanceMinor: '-1250000',
        creditLimitMinor: '10000000',
      }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Rewards Card was added.');
    expect(await screen.findByRole('region', { name: 'Money you owe' })).toBeDefined();
    expect(services.listAccounts).toHaveBeenCalledTimes(2);
  });

  it('shows server-side problems in the form', async () => {
    respondWith([], { currencies: [] });
    services.createAccount.mockRejectedValue(
      Object.assign(apiError('VALIDATION_ERROR', 'The request is invalid.'), {
        details: [
          {
            path: 'body.openingBalanceDate',
            message: 'The opening balance date cannot be in the future.',
          },
        ],
      }),
    );
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add an account' }));
    const form = await screen.findByRole('form', { name: 'Add an account' });
    await user.click(within(form).getByRole('radio', { name: /Savings account/ }));
    await user.type(within(form).getByLabelText('Account name'), 'Rainy day');
    await user.type(within(form).getByLabelText('Current balance'), '0');
    await user.click(within(form).getByRole('button', { name: 'Add account' }));

    expect(
      await within(form).findByText('The opening balance date cannot be in the future.'),
    ).toBeDefined();
    expect(within(form).getByRole('alert').textContent).toContain(
      'Some details need your attention',
    );
    expect(within(form).getByRole('button', { name: 'Add account' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('edits only what changed', async () => {
    respondWith([bank]);
    services.updateAccount.mockResolvedValue({
      ...bank,
      account: { ...bank.account, name: 'Salary account' },
    });
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Actions for HDFC Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit account' });
    const name = within(form).getByLabelText('Account name');
    await user.clear(name);
    await user.type(name, 'Salary account');
    // Only money-held types are offered for a bank account.
    expect(within(form).queryByRole('radio', { name: /Credit card/ })).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(services.updateAccount).toHaveBeenCalledWith(bank.account.id, {
      name: 'Salary account',
    });
    expect((await screen.findByRole('status')).textContent).toContain(
      'Salary account was updated.',
    );
  });

  it('locks the opening balance once the account has transactions', async () => {
    respondWith([{ ...bank, hasTransactions: true }]);
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Actions for HDFC Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit account' });

    expect(within(form).getByText('Opening balance locked')).toBeDefined();
    expect(within(form).getByLabelText('Current balance').hasAttribute('disabled')).toBe(true);
    expect(within(form).getByLabelText('Currency').hasAttribute('disabled')).toBe(true);
    expect(within(form).getByLabelText('Balance as of').hasAttribute('disabled')).toBe(true);
  });

  it('archives after an accessible confirmation and refreshes', async () => {
    respondWith([bank, card]);
    services.archiveAccount.mockResolvedValue({
      ...card,
      account: { ...card.account, status: 'archived', archivedAt: TIMESTAMP },
    });
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Actions for Rewards Card' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive Rewards Card?' });
    expect(within(dialog).getByText(/history are kept/)).toBeDefined();

    respondWith([bank]);
    await user.click(within(dialog).getByRole('button', { name: 'Archive account' }));

    expect(services.archiveAccount).toHaveBeenCalledWith(card.account.id);
    expect((await screen.findByRole('status')).textContent).toContain('Rewards Card was archived.');
    await vi.waitFor(() => {
      expect(screen.queryByText('Rewards Card')).toBeNull();
    });
  });

  it('can cancel archiving with the keyboard', async () => {
    respondWith([bank]);
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Actions for HDFC Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(services.archiveAccount).not.toHaveBeenCalled();
  });

  it('lists archived accounts separately and restores them', async () => {
    respondWith([bank]);
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();
    await screen.findByText('HDFC Salary');

    const archived = {
      ...card,
      account: { ...card.account, status: 'archived' as const, archivedAt: TIMESTAMP },
    };
    services.listAccounts.mockResolvedValue({ accounts: [archived] });
    services.restoreAccount.mockResolvedValue(card);
    await user.click(screen.getByRole('radio', { name: 'Archived' }));

    expect(await screen.findByRole('region', { name: 'Archived accounts' })).toBeDefined();
    expect(services.listAccounts).toHaveBeenLastCalledWith('archived', expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Actions for Rewards Card' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));

    expect(services.restoreAccount).toHaveBeenCalledWith(card.account.id);
    expect((await screen.findByRole('status')).textContent).toContain(
      'Rewards Card is active again.',
    );
  });

  it('opens account details without inventing a transaction history', async () => {
    respondWith([card]);
    renderWithAuth(<AccountsOverview />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Rewards Card' }));
    const sheet = await screen.findByRole('dialog', { name: 'Rewards Card' });

    expect(within(sheet).getByText('Owed when you started')).toBeDefined();
    expect(within(sheet).getByText(/Transactions will appear here/)).toBeDefined();
    expect(within(sheet).getByRole('button', { name: 'Edit account' })).toBeDefined();
  });
});
