// @vitest-environment jsdom
import type {
  AccountWithBalanceDto,
  AiStatusDto,
  CategoryDto,
  ConversationDto,
  ConversationMessageDto,
  SendMessageResultDto,
} from '@calmcash/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAiStatus } from '@/features/ai/use-ai-status';
import { apiError, renderWithAuth } from '@/testing/auth';

import { AssistantPage } from './components/assistant-page';

// --- Mocks ---------------------------------------------------------------------------------------

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn<(href: string) => void>(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.search,
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  usePathname: () => '/assistant',
}));

const ai = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  sendMessage: vi.fn(),
  draftTransaction: vi.fn(),
  suggestEntryCategory: vi.fn(),
}));
vi.mock('@/services/ai.service', () => ai);

const accounts = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('@/services/accounts.service', () => accounts);
const categories = vi.hoisted(() => ({ listCategories: vi.fn() }));
vi.mock('@/services/categories.service', () => categories);
const transactions = vi.hoisted(() => ({ listTags: vi.fn(), createTransaction: vi.fn() }));
vi.mock('@/services/transactions.service', () => transactions);

// --- Data ----------------------------------------------------------------------------------------

const USER = '0193a000-0000-7000-8000-000000000001';
const BANK = '0193a000-0000-7000-8000-000000000201';
const FOOD = '0193a000-0000-7000-8000-000000000101';
const CONVERSATION = '0193a000-0000-7000-8000-000000000501';
const AT = '2026-10-31T05:00:00.000Z';

const READY: AiStatusDto = {
  available: true,
  serverEnabled: true,
  enabledForUser: true,
  provider: 'ollama',
  model: 'qwen3:1.7b',
  modelInstalled: true,
};

const bank: AccountWithBalanceDto = {
  account: {
    id: BANK,
    userId: USER,
    name: 'HDFC Salary',
    type: 'bank',
    classification: 'asset',
    currency: 'INR',
    openingBalanceMinor: '0',
    openingBalanceDate: '2026-01-01',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
  },
  balance: { currentBalanceMinor: '5000000', countedTransactions: 1 },
  hasTransactions: true,
};

const food: CategoryDto = {
  id: FOOD,
  userId: USER,
  name: 'Food',
  kind: 'expense',
  status: 'active',
  createdAt: AT,
  updatedAt: AT,
};

const conversation: ConversationDto = {
  id: CONVERSATION,
  title: 'Where did my money go this month?',
  createdAt: AT,
  updatedAt: AT,
};

function message(overrides: Partial<ConversationMessageDto>): ConversationMessageDto {
  return {
    id: '0193a000-0000-7000-8000-000000000601',
    role: 'assistant',
    content: '',
    blocks: [],
    followUps: [],
    createdAt: AT,
    ...overrides,
  };
}

function answer(assistant: Partial<ConversationMessageDto>, content: string): SendMessageResultDto {
  return {
    conversation,
    userMessage: message({ id: '0193a000-0000-7000-8000-000000000611', role: 'user', content }),
    assistantMessage: message({ id: '0193a000-0000-7000-8000-000000000612', ...assistant }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAiStatus();
  navigation.search = new URLSearchParams();
  ai.getAiStatus.mockResolvedValue(READY);
  ai.listConversations.mockResolvedValue({ items: [] });
  ai.createConversation.mockResolvedValue(conversation);
  ai.getConversation.mockResolvedValue({ conversation, messages: [] });
  accounts.listAccounts.mockResolvedValue({ accounts: [bank] });
  categories.listCategories.mockResolvedValue({ categories: [food] });
  transactions.listTags.mockResolvedValue({ tags: [] });
});

describe('AssistantPage', () => {
  it('starts a conversation from a suggested question and shows figures from the records', async () => {
    ai.sendMessage.mockResolvedValue(
      answer(
        {
          content: 'You spent ₹12,000.00 in October.',
          narrative: 'assistant',
          outcome: 'answered',
          followUps: ['Which category grew most?'],
          blocks: [
            {
              kind: 'figures',
              title: 'Cash flow',
              currency: 'INR',
              period: { from: '2026-10-01', to: '2026-10-31' },
              figures: [{ label: 'Money out', amountMinor: '1200000', text: '2 expenses' }],
            },
            {
              kind: 'links',
              links: [
                {
                  label: 'Open the dashboard for this period',
                  target: { kind: 'dashboard', period: 'this-month', currency: 'INR' },
                },
              ],
            },
          ],
        },
        'Where did my money go this month?',
      ),
    );
    const user = userEvent.setup();
    renderWithAuth(<AssistantPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Where did my money go this month?' }),
    );

    expect(await screen.findByText('You spent ₹12,000.00 in October.')).toBeDefined();
    expect(ai.createConversation).toHaveBeenCalledOnce();
    expect(ai.sendMessage).toHaveBeenCalledWith(CONVERSATION, 'Where did my money go this month?');
    expect(navigation.replace).toHaveBeenCalledWith(`/assistant?c=${CONVERSATION}`, {
      scroll: false,
    });
    const figures = screen.getByRole('region', { name: 'Cash flow' });
    expect(within(figures).getByText('Money out')).toBeDefined();
    expect(within(figures).getByText(/12,000\.00/)).toBeDefined();
    expect(screen.getByRole('link', { name: /Open the dashboard/ }).getAttribute('href')).toBe(
      '/dashboard?period=this-month&currency=INR',
    );
    expect(screen.getByRole('button', { name: 'Which category grew most?' })).toBeDefined();
  });

  it('sends with Enter and keeps the question when the model is unavailable', async () => {
    ai.sendMessage.mockRejectedValue(
      apiError('AI_UNAVAILABLE', 'The local AI service (Ollama) is not running.', 503),
    );
    const user = userEvent.setup();
    renderWithAuth(<AssistantPage />);

    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Your question' });
    await user.type(box, 'Am I over budget?{Enter}');

    expect(await screen.findByText('The local AI service (Ollama) is not running.')).toBeDefined();
    expect(box.value).toBe('Am I over budget?');
  });

  it('explains why questions cannot be asked and keeps history readable', async () => {
    ai.getAiStatus.mockResolvedValue({ ...READY, available: false, problem: 'unreachable' });
    ai.listConversations.mockResolvedValue({ items: [conversation] });
    navigation.search = new URLSearchParams({ c: CONVERSATION });
    ai.getConversation.mockResolvedValue({
      conversation,
      messages: [
        message({ id: '0193a000-0000-7000-8000-000000000621', role: 'user', content: 'Hi' }),
        message({ id: '0193a000-0000-7000-8000-000000000622', content: 'Earlier answer.' }),
      ],
    });
    renderWithAuth(<AssistantPage />);

    expect(await screen.findByText('Earlier answer.')).toBeDefined();
    expect(screen.getByText('The assistant cannot answer right now')).toBeDefined();
    expect(screen.getAllByText(/Ollama\) is not running/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Your question' }).disabled,
    ).toBe(true);
  });

  it('opens a draft in the ordinary entry form, filled in but not saved', async () => {
    ai.sendMessage.mockResolvedValue(
      answer(
        {
          content: 'Here is a draft. Check every field and save it yourself.',
          outcome: 'answered',
          narrative: 'template',
          blocks: [
            {
              kind: 'transaction_draft',
              result: {
                kind: 'draft',
                draft: {
                  type: 'expense',
                  amount: '450.00',
                  currency: 'INR',
                  accountId: BANK,
                  date: '2026-10-30',
                  description: 'Dinner',
                  merchant: 'Swiggy',
                  categoryId: FOOD,
                  tags: [],
                },
                notes: [],
              },
            },
          ],
        },
        'Spent 450 on dinner',
      ),
    );
    const user = userEvent.setup();
    renderWithAuth(<AssistantPage />);
    await user.type(
      await screen.findByRole('textbox', { name: 'Your question' }),
      'Spent 450 on dinner{Enter}',
    );

    const draft = await screen.findByRole('region', { name: 'Transaction draft' });
    expect(within(draft).getByText('Draft — not saved')).toBeDefined();
    expect(within(draft).getByText('HDFC Salary')).toBeDefined();
    await user.click(within(draft).getByRole('button', { name: 'Review and save' }));

    const form = await screen.findByRole('form', { name: 'Add a transaction' });
    expect(within(form).getByText('Filled in from your words')).toBeDefined();
    expect(within(form).getByLabelText<HTMLInputElement>('Amount').value).toBe('450.00');
    expect(within(form).getByLabelText<HTMLInputElement>('Paid to').value).toBe('Swiggy');
    expect(transactions.createTransaction).not.toHaveBeenCalled();
  });

  it('renames and deletes conversations', async () => {
    ai.listConversations.mockResolvedValue({ items: [conversation] });
    ai.renameConversation.mockResolvedValue({ ...conversation, title: 'October' });
    ai.deleteConversation.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithAuth(<AssistantPage />);

    const list = await screen.findByRole('navigation', { name: 'Conversations' });
    await user.click(within(list).getByRole('button', { name: `Rename ${conversation.title}` }));
    const title = within(list).getByRole('textbox', { name: 'Conversation title' });
    await user.clear(title);
    await user.type(title, 'October{Enter}');
    await waitFor(() => {
      expect(ai.renameConversation).toHaveBeenCalledWith(CONVERSATION, 'October');
    });

    await user.click(within(list).getByRole('button', { name: `Delete ${conversation.title}` }));
    await user.click(await screen.findByRole('button', { name: 'Delete conversation' }));
    await waitFor(() => {
      expect(ai.deleteConversation).toHaveBeenCalledWith(CONVERSATION);
    });
  });
});
