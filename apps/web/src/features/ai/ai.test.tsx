// @vitest-environment jsdom
import type { AiStatusDto, AssistantLinkTarget } from '@calmcash/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '@/testing/auth';

import { assistantHref, describeAiProblem } from './ai-presentation';
import { AiPrivacySettings } from './components/ai-privacy-settings';
import { AssistantBlocks } from './components/assistant-blocks';
import { invalidateAiStatus } from './use-ai-status';

const ai = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  updateAiPreferences: vi.fn(),
  clearConversations: vi.fn(),
  listMerchantRules: vi.fn(),
  deleteMerchantRule: vi.fn(),
}));
vi.mock('@/services/ai.service', () => ai);

const TX = '0193a000-0000-7000-8000-000000000301';
const READY: AiStatusDto = {
  available: true,
  serverEnabled: true,
  enabledForUser: true,
  provider: 'ollama',
  model: 'qwen3:1.7b',
  modelInstalled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAiStatus();
  ai.getAiStatus.mockResolvedValue(READY);
  ai.listMerchantRules.mockResolvedValue([]);
});

describe('assistantHref', () => {
  it('leads to the pages’ own URLs, inside CalmCash only', () => {
    const cases: [AssistantLinkTarget, unknown][] = [
      [
        {
          kind: 'transactions',
          filters: { type: 'expense', categoryId: TX, from: '2026-10-01', to: '2026-10-31' },
        },
        {
          pathname: '/transactions',
          query: { type: 'expense', categoryId: TX, from: '2026-10-01', to: '2026-10-31' },
        },
      ],
      [
        { kind: 'transaction', transactionId: TX },
        { pathname: '/transactions', query: { transaction: TX } },
      ],
      [
        { kind: 'budget', budgetId: TX },
        { pathname: '/budgets', query: { budget: TX } },
      ],
      [{ kind: 'subscriptions' }, { pathname: '/budgets', query: { section: 'subscriptions' } }],
      [{ kind: 'recurring' }, { pathname: '/budgets', query: { section: 'recurring' } }],
      [{ kind: 'goals' }, { pathname: '/budgets', query: { section: 'goals' } }],
      [{ kind: 'accounts' }, '/accounts'],
      [{ kind: 'insights' }, '/insights'],
      [
        {
          kind: 'dashboard',
          period: 'custom',
          from: '2026-10-01',
          to: '2026-10-31',
          currency: 'INR',
        },
        {
          pathname: '/dashboard',
          query: { period: 'custom', from: '2026-10-01', to: '2026-10-31', currency: 'INR' },
        },
      ],
    ];
    for (const [target, href] of cases) {
      expect(assistantHref(target)).toEqual(href);
    }
  });

  it('explains every problem in plain words', () => {
    expect(describeAiProblem('model_missing', 'qwen3:1.7b')).toContain(
      '“qwen3:1.7b” is not installed',
    );
    expect(describeAiProblem('disabled_by_user', 'm')).toContain('Settings');
    expect(describeAiProblem('busy', 'm')).toContain('try again');
  });
});

describe('AssistantBlocks', () => {
  it('shows exact amounts with their currency, transactions as links, and notices', () => {
    render(
      <AssistantBlocks
        timeZone="Asia/Kolkata"
        blocks={[
          {
            kind: 'transactions',
            title: 'Matching transactions',
            totalCount: 12,
            items: [
              {
                id: TX,
                occurredAt: '2026-10-05T06:00:00.000Z',
                type: 'expense',
                description: 'Weekly groceries',
                merchant: 'FreshMart',
                category: 'Groceries',
                amountMinor: '245050',
                currency: 'INR',
              },
            ],
          },
          {
            kind: 'categories',
            title: 'Spending by category',
            currency: 'USD',
            period: { from: '2026-10-01', to: '2026-10-31' },
            items: [{ name: 'Travel', amountMinor: '4500', shareBasisPoints: '7500' }],
          },
          {
            kind: 'notice',
            tone: 'warning',
            text: 'Part of that question could not be looked up.',
          },
        ]}
      />,
    );

    const list = screen.getByRole('region', { name: 'Matching transactions' });
    expect(within(list).getByText(/12 matches, 1 shown/)).toBeDefined();
    const link = within(list).getByRole('link');
    expect(link.getAttribute('href')).toBe(`/transactions?transaction=${TX}`);
    expect(within(link).getByText(/2,450\.50/)).toBeDefined();
    const categories = screen.getByRole('region', { name: 'Spending by category' });
    expect(within(categories).getByText(/\$45\.00/)).toBeDefined();
    expect(within(categories).getByText('75.0%')).toBeDefined();
    expect(screen.getByText('Part of that question could not be looked up.')).toBeDefined();
  });

  it('shows a clarification draft with its question and notes, and nothing for a non-transaction', async () => {
    const onReview = vi.fn();
    const user = userEvent.setup();
    render(
      <AssistantBlocks
        timeZone="Asia/Kolkata"
        onReviewDraft={onReview}
        blocks={[
          {
            kind: 'transaction_draft',
            result: {
              kind: 'clarification',
              question: 'Which account did you pay from?',
              draft: { type: 'expense', amount: '80.00', currency: 'INR', tags: [] },
              notes: [{ field: 'account', message: 'Choose the account.' }],
            },
          },
          {
            kind: 'transaction_draft',
            result: { kind: 'not_a_transaction', reason: 'That has not happened yet.' },
          },
        ]}
      />,
    );

    const draft = screen.getByRole('region', { name: 'Transaction draft' });
    expect(within(draft).getByText('Which account did you pay from?')).toBeDefined();
    expect(within(draft).getByText('Choose the account.')).toBeDefined();
    expect(within(draft).getAllByText('Not chosen yet').length).toBeGreaterThan(0);
    expect(screen.queryByText('That has not happened yet.')).toBeNull();
    await user.click(within(draft).getByRole('button', { name: 'Review and save' }));
    expect(onReview).toHaveBeenCalledOnce();
  });
});

describe('AiPrivacySettings', () => {
  it('shows the local model and what it never sees, and switches AI off', async () => {
    ai.updateAiPreferences.mockResolvedValue({ enabled: false });
    const user = userEvent.setup();
    renderWithAuth(<AiPrivacySettings />);

    expect(await screen.findByText(/qwen3:1\.7b on your own computer/)).toBeDefined();
    expect(screen.getByText(/never an outside AI service/)).toBeDefined();
    expect(screen.getByText(/Passwords, sign-in sessions/)).toBeDefined();
    ai.getAiStatus.mockResolvedValue({
      ...READY,
      available: false,
      enabledForUser: false,
      problem: 'disabled_by_user',
    });
    await user.click(screen.getByRole('checkbox', { name: /Use AI features/ }));

    expect(ai.updateAiPreferences).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/AI features are off/)).toBeDefined();
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: /Use AI features/ }).checked,
      ).toBe(false);
    });
  });

  it('deletes all conversations only after confirmation', async () => {
    ai.clearConversations.mockResolvedValue(3);
    const user = userEvent.setup();
    renderWithAuth(<AiPrivacySettings />);

    await user.click(await screen.findByRole('button', { name: 'Delete all conversations' }));
    expect(ai.clearConversations).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Delete all' }));

    expect(await screen.findByText('Deleted 3 conversations.')).toBeDefined();
  });

  it('cannot be switched on when the installation has AI off', async () => {
    ai.getAiStatus.mockResolvedValue({
      ...READY,
      available: false,
      serverEnabled: false,
      problem: 'disabled_by_server',
    });
    renderWithAuth(<AiPrivacySettings />);

    const toggle = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: /Use AI features/,
    });
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText(/switched off for this whole CalmCash installation/)).toBeDefined();
  });
});
