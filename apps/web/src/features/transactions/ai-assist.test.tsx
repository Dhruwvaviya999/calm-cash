// @vitest-environment jsdom
import type { AccountDto, AiStatusDto, CategoryDto } from '@calmcash/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAiStatus } from '@/features/ai/use-ai-status';

import { SmartSearch, filtersFromInterpretation, withoutChips } from './components/smart-search';
import { TransactionForm } from './components/transaction-form';
import { DEFAULT_FILTERS } from './transaction-filters';
import { draftToFormValues } from './transaction-form-model';

const ai = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  interpretSearch: vi.fn(),
  draftTransaction: vi.fn(),
  suggestEntryCategory: vi.fn(),
}));
vi.mock('@/services/ai.service', () => ai);

const transactions = vi.hoisted(() => ({ createTransaction: vi.fn(), updateTransaction: vi.fn() }));
vi.mock('@/services/transactions.service', () => transactions);

const USER = '0193a000-0000-7000-8000-000000000001';
const BANK = '0193a000-0000-7000-8000-000000000201';
const CASH = '0193a000-0000-7000-8000-000000000202';
const FOOD = '0193a000-0000-7000-8000-000000000101';
const AT = '2026-10-31T05:00:00.000Z';

const READY: AiStatusDto = {
  available: true,
  serverEnabled: true,
  enabledForUser: true,
  provider: 'ollama',
  model: 'qwen3:1.7b',
};

function account(id: string, name: string): AccountDto {
  return {
    id,
    userId: USER,
    name,
    type: 'bank',
    classification: 'asset',
    currency: 'INR',
    openingBalanceMinor: '0',
    openingBalanceDate: '2026-01-01',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
  };
}

const food: CategoryDto = {
  id: FOOD,
  userId: USER,
  name: 'Food',
  kind: 'expense',
  status: 'active',
  createdAt: AT,
  updatedAt: AT,
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAiStatus();
  ai.getAiStatus.mockResolvedValue(READY);
});

describe('search filters from plain words', () => {
  const filters = {
    type: 'expense',
    categoryId: FOOD,
    minAmount: '2000',
    from: '2026-09-01',
    to: '2026-09-30',
    sort: 'largest',
  } as const;

  it('keeps everything except what the person removed; a date chip covers both ends', () => {
    expect(withoutChips(filters, new Set(['categoryId', 'from']))).toEqual({
      type: 'expense',
      minAmount: '2000',
      sort: 'largest',
    });
  });

  it('turns the result into the list’s own filters, starting from the defaults', () => {
    expect(filtersFromInterpretation({ type: 'income' }, 'oldest')).toEqual({
      ...DEFAULT_FILTERS,
      type: 'income',
      sort: 'oldest',
    });
    expect(filtersFromInterpretation(filters, 'newest')).toMatchObject({
      type: 'expense',
      categoryId: FOOD,
      minAmount: '2000',
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'largest',
      q: '',
      page: 1,
    });
  });

  it('shows the suggested filters as chips to check before applying', async () => {
    ai.interpretSearch.mockResolvedValue({
      kind: 'filters',
      query: 'food expenses above 2000 last month',
      filters,
      chips: [
        { key: 'type', label: 'Expenses' },
        { key: 'categoryId', label: 'Category: Food' },
        { key: 'minAmount', label: 'At least 2000' },
        { key: 'from', label: '1 Sept 2026 – 30 Sept 2026' },
      ],
      unresolved: ['yachts'],
    });
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<SmartSearch sort="newest" onApply={onApply} />);

    await user.click(await screen.findByRole('button', { name: 'Search in plain words' }));
    await user.type(
      screen.getByLabelText('Describe what you are looking for'),
      'food expenses above 2000 last month',
    );
    await user.click(screen.getByRole('button', { name: 'Find filters' }));

    const chips = await screen.findByRole('list', { name: 'Suggested filters' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/“yachts”/)).toBeDefined();
    await user.click(
      screen.getByRole('button', { name: 'Remove suggested filter Category: Food' }),
    );
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'expense', categoryId: undefined, minAmount: '2000' }),
    );
  });

  it('stays hidden while AI is unavailable', async () => {
    ai.getAiStatus.mockResolvedValue({ ...READY, available: false, problem: 'unreachable' });
    render(<SmartSearch sort="newest" onApply={vi.fn()} />);

    await vi.waitFor(() => {
      expect(ai.getAiStatus).toHaveBeenCalled();
    });
    expect(screen.queryByRole('button', { name: 'Search in plain words' })).toBeNull();
  });
});

describe('drafts in the transaction form', () => {
  it('converts a draft into editable form values', () => {
    const now = new Date('2026-10-31T06:15:00.000Z');
    expect(
      draftToFormValues(
        {
          type: 'expense',
          amount: '450.00',
          accountId: BANK,
          date: '2026-10-30',
          merchant: 'Swiggy',
          tags: ['Food ', 'food'],
        },
        'Asia/Kolkata',
        now,
      ),
    ).toMatchObject({
      type: 'expense',
      amount: '450.00',
      accountId: BANK,
      date: '2026-10-30',
      time: '11:45',
      merchant: 'Swiggy',
      tags: 'food',
    });
    expect(
      draftToFormValues(
        {
          type: 'transfer',
          accountId: BANK,
          transferAccountId: CASH,
          merchant: 'x',
          categoryId: FOOD,
          tags: [],
        },
        'Asia/Kolkata',
        now,
      ),
    ).toMatchObject({ type: 'transfer', transferAccountId: CASH, merchant: '', categoryId: '' });
  });

  function renderForm(): void {
    render(
      <TransactionForm
        mode={{ kind: 'create', type: 'expense' }}
        accounts={[account(BANK, 'HDFC Salary'), account(CASH, 'Wallet cash')]}
        categories={[food]}
        tagSuggestions={[]}
        timeZone="Asia/Kolkata"
        defaultCurrency="INR"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onAdjustBalance={vi.fn()}
      />,
    );
  }

  it('fills the form from a description, records nothing, and says what to check', async () => {
    ai.draftTransaction.mockResolvedValue({
      kind: 'clarification',
      question: 'Which account did you pay from?',
      draft: {
        type: 'expense',
        amount: '450.00',
        currency: 'INR',
        merchant: 'Swiggy',
        categoryId: FOOD,
        tags: [],
      },
      notes: [{ field: 'account', message: 'Choose the account.' }],
    });
    const user = userEvent.setup();
    renderForm();

    const describe = await screen.findByLabelText('Describe it in your words (optional)');
    await user.type(describe, 'Spent 450 at Swiggy{Enter}');

    expect(await screen.findByText('Filled in from your words')).toBeDefined();
    expect(screen.getByText('Which account did you pay from?')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toBe('450.00');
    expect(screen.getByLabelText<HTMLInputElement>('Paid to').value).toBe('Swiggy');
    expect(screen.getByLabelText<HTMLSelectElement>('Category').value).toBe(FOOD);
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it('applies a category suggestion only when the person picks it', async () => {
    ai.suggestEntryCategory.mockResolvedValue({
      categoryId: FOOD,
      basis: 'your_history',
      reason: 'You chose Food for 3 earlier payments like this.',
    });
    const user = userEvent.setup();
    renderForm();

    await user.type(await screen.findByLabelText('Paid to'), 'Swiggy');
    await user.click(screen.getByRole('button', { name: 'Suggest a category' }));
    expect(await screen.findByText(/You chose Food for 3 earlier payments/)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>('Category').value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Use Food' }));
    expect(screen.getByLabelText<HTMLSelectElement>('Category').value).toBe(FOOD);
    expect(ai.suggestEntryCategory).toHaveBeenCalledWith({
      type: 'expense',
      description: 'Swiggy',
      merchant: 'Swiggy',
    });
  });
});
