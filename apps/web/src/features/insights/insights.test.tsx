// @vitest-environment jsdom
import type {
  AiStatusDto,
  InsightListDto,
  RecurringCandidateDto,
  TransactionListItemDto,
} from '@calmcash/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAiStatus } from '@/features/ai/use-ai-status';
import { renderWithAuth } from '@/testing/auth';

import { InsightsPage } from './components/insights-page';
import { scheduleValuesFromCandidate } from './insights-presentation';

// --- Mocks ---------------------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/insights',
}));

const insights = vi.hoisted(() => ({
  listInsights: vi.fn(),
  listRecurringCandidates: vi.fn(),
  dismissInsight: vi.fn(),
  dismissRecurringCandidate: vi.fn(),
}));
vi.mock('@/services/insights.service', () => insights);

const ai = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  explainInsight: vi.fn(),
  suggestCategories: vi.fn(),
  rejectCategorySuggestion: vi.fn(),
  getMerchantSuggestions: vi.fn(),
  saveMerchantRule: vi.fn(),
  dismissMerchantSuggestion: vi.fn(),
  createReport: vi.fn(),
}));
vi.mock('@/services/ai.service', () => ai);

const transactions = vi.hoisted(() => ({ listTransactions: vi.fn(), updateTransaction: vi.fn() }));
vi.mock('@/services/transactions.service', () => transactions);
const categories = vi.hoisted(() => ({ listCategories: vi.fn() }));
vi.mock('@/services/categories.service', () => categories);
const accounts = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('@/services/accounts.service', () => accounts);
const recurring = vi.hoisted(() => ({ createSchedule: vi.fn() }));
vi.mock('@/services/recurring.service', () => recurring);

// --- Data ----------------------------------------------------------------------------------------

const USER = '0193a000-0000-7000-8000-000000000001';
const BANK = '0193a000-0000-7000-8000-000000000201';
const FOOD = '0193a000-0000-7000-8000-000000000101';
const STREAMING = '0193a000-0000-7000-8000-000000000102';
const TX = '0193a000-0000-7000-8000-000000000301';
const AT = '2026-10-31T05:00:00.000Z';

const READY: AiStatusDto = {
  available: true,
  serverEnabled: true,
  enabledForUser: true,
  provider: 'ollama',
  model: 'qwen3:1.7b',
};

const INSIGHTS: InsightListDto = {
  period: { from: '2026-10-01', to: '2026-10-31' },
  currency: 'INR',
  currencies: ['INR'],
  insufficientHistory: false,
  items: [
    {
      key: `up:INR:2026-10-01:${FOOD}`,
      kind: 'category_increase',
      currency: 'INR',
      period: { from: '2026-10-01', to: '2026-10-31' },
      comparedTo: { from: '2026-09-01', to: '2026-09-30' },
      title: 'Food spending rose by 50.0%',
      detail: '₹6,000.00 in October, compared with ₹4,000.00 in September.',
      figures: [
        { label: 'October', amountMinor: '600000' },
        { label: 'September', amountMinor: '400000' },
        { label: 'Change', text: '+50.0%' },
      ],
      link: {
        label: 'View Food expenses',
        target: { kind: 'transactions', filters: { type: 'expense', categoryId: FOOD } },
      },
    },
  ],
};

const CANDIDATE: RecurringCandidateDto = {
  key: 'rc:INR:netflix',
  label: 'Netflix',
  merchant: 'Netflix',
  currency: 'INR',
  typicalAmountMinor: '64900',
  minAmountMinor: '64900',
  maxAmountMinor: '64900',
  frequency: 'monthly',
  lastDate: '2026-10-05',
  nextEstimatedDate: '2026-11-05',
  occurrences: 4,
  transactionIds: [TX],
  accountId: BANK,
  categoryId: STREAMING,
  strength: 'possible',
  evidence:
    '4 payments, 3 of 3 gaps fit a monthly rhythm, amounts ₹649.00. The next date is an estimate.',
  likelySubscription: true,
};

const UNCATEGORISED: TransactionListItemDto = {
  transaction: {
    id: TX,
    userId: USER,
    accountId: BANK,
    type: 'expense',
    amountMinor: '200000',
    currency: 'INR',
    description: 'HP PETROL PUMP 0042',
    tags: [],
    status: 'active',
    occurredAt: '2026-10-20T06:00:00.000Z',
    createdAt: AT,
    updatedAt: AT,
  },
  account: { id: BANK, name: 'HDFC Salary', type: 'bank', currency: 'INR', status: 'active' },
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAiStatus();
  ai.getAiStatus.mockResolvedValue(READY);
  insights.listInsights.mockResolvedValue(INSIGHTS);
  insights.listRecurringCandidates.mockResolvedValue({ items: [CANDIDATE] });
  transactions.listTransactions.mockResolvedValue({
    items: [UNCATEGORISED],
    pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
  });
  categories.listCategories.mockResolvedValue({
    categories: [
      {
        id: FOOD,
        userId: USER,
        name: 'Fuel',
        kind: 'expense',
        status: 'active',
        createdAt: AT,
        updatedAt: AT,
      },
      {
        id: STREAMING,
        userId: USER,
        name: 'Streaming',
        kind: 'expense',
        status: 'active',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
  });
  accounts.listAccounts.mockResolvedValue({ accounts: [] });
});

describe('scheduleValuesFromCandidate', () => {
  it('starts the planning form from the noticed amount, rhythm, and next date', () => {
    expect(scheduleValuesFromCandidate({ ...CANDIDATE, frequency: 'quarterly' })).toEqual({
      name: 'Netflix',
      type: 'expense',
      amount: '649.00',
      currency: 'INR',
      accountId: BANK,
      categoryId: STREAMING,
      merchant: 'Netflix',
      repeat: 'monthly:3',
      frequency: 'monthly',
      interval: '3',
      startDate: '2026-11-05',
    });
  });
});

describe('InsightsPage', () => {
  it('shows patterns with exact figures, explains on request, and hides on request', async () => {
    ai.explainInsight.mockResolvedValue({
      key: INSIGHTS.items[0]?.key ?? '',
      explanation: 'Food took ₹6,000.00 in October, up from ₹4,000.00.',
      narrative: 'assistant',
    });
    insights.dismissInsight.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithAuth(<InsightsPage />);

    const card = (
      await screen.findByRole('heading', { name: 'Food spending rose by 50.0%' })
    ).closest('li');
    if (card === null) throw new Error('insight card missing');
    expect(within(card).getByText(/6,000\.00/, { selector: 'span *, span' })).toBeDefined();
    expect(
      within(card)
        .getByRole('link', { name: /View Food expenses/ })
        .getAttribute('href'),
    ).toBe(`/transactions?type=expense&categoryId=${FOOD}`);

    await user.click(within(card).getByRole('button', { name: 'Explain' }));
    expect(await within(card).findByText(/Food took ₹6,000\.00/)).toBeDefined();
    expect(ai.explainInsight).toHaveBeenCalledWith({
      key: INSIGHTS.items[0]?.key,
      period: 'this-month',
    });

    await user.click(
      within(card).getByRole('button', { name: 'Hide: Food spending rose by 50.0%' }),
    );
    await waitFor(() => {
      expect(insights.dismissInsight).toHaveBeenCalledWith(INSIGHTS.items[0]?.key);
    });
  });

  it('keeps patterns and suggestions working without AI, minus explanations', async () => {
    ai.getAiStatus.mockResolvedValue({ ...READY, available: false, problem: 'unreachable' });
    renderWithAuth(<InsightsPage />);

    expect(
      await screen.findByRole('heading', { name: 'Food spending rose by 50.0%' }),
    ).toBeDefined();
    expect(
      screen.getByText(/Patterns, repeating payments, history-based suggestions/),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
  });

  it('opens the subscription form filled in from a repeating payment, without saving', async () => {
    const user = userEvent.setup();
    renderWithAuth(<InsightsPage />);

    expect(await screen.findByText(/4 payments, 3 of 3 gaps fit a monthly rhythm/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Track as subscription/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Track a subscription' });
    // Name and merchant both start from the noticed payee.
    expect(within(dialog).getAllByDisplayValue('Netflix')).toHaveLength(2);
    expect(within(dialog).getByDisplayValue('649.00')).toBeDefined();
    expect(recurring.createSchedule).not.toHaveBeenCalled();
  });

  it('suggests categories for uncategorised transactions and applies one on accept', async () => {
    ai.suggestCategories.mockResolvedValue({
      items: [
        {
          transactionId: TX,
          categoryId: FOOD,
          basis: 'assistant',
          reason: 'PETROL PUMP in the description',
        },
      ],
      assistantUsed: true,
    });
    transactions.updateTransaction.mockResolvedValue(UNCATEGORISED);
    const user = userEvent.setup();
    renderWithAuth(<InsightsPage />);

    expect(await screen.findByText('HP PETROL PUMP 0042')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Suggest categories' }));
    expect(await screen.findByText(/PETROL PUMP in the description/)).toBeDefined();
    expect(transactions.updateTransaction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(transactions.updateTransaction).toHaveBeenCalledWith(TX, { categoryId: FOOD });
    });
  });

  it('creates a report for the selected period on request', async () => {
    ai.createReport.mockResolvedValue({
      kind: 'period',
      period: { from: '2026-10-01', to: '2026-10-31' },
      currency: 'INR',
      title: 'Financial summary — 1 Oct 2026 – 31 Oct 2026',
      sections: [],
      narrative: 'Here is your cash flow for October.',
      narrativeSource: 'template',
      generatedAt: AT,
    });
    const user = userEvent.setup();
    renderWithAuth(<InsightsPage />);

    await user.click(await screen.findByRole('button', { name: 'Create report' }));

    expect(await screen.findByText('Financial summary — 1 Oct 2026 – 31 Oct 2026')).toBeDefined();
    expect(screen.getByText('Standard summary wording.')).toBeDefined();
    expect(ai.createReport).toHaveBeenCalledWith({ kind: 'period', period: 'this-month' });
  });
});
