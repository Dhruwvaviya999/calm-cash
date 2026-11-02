'use client';

import {
  entityIdSchema,
  type AccountWithBalanceDto,
  type CategoryDto,
  type ConversationMessageDto,
  type TransactionListItemDto,
} from '@calmcash/shared';
import { MessagesSquare, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import { FormMessage } from '@/components/forms/form-message';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { describeAiProblem, SUGGESTED_QUESTIONS } from '@/features/ai/ai-presentation';
import type { ReferenceNames } from '@/features/ai/components/assistant-blocks';
import { invalidateAiStatus, useAiStatus } from '@/features/ai/use-ai-status';
import { useSignedInSession } from '@/features/auth';
import {
  prefillFromDraft,
  TransactionEntrySheet,
  type EntrySheetMode,
} from '@/features/transactions';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { ApiClientError } from '@/lib/api-client';
import { describeRequestError } from '@/lib/form-errors';
import { listAccounts } from '@/services/accounts.service';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  sendMessage,
} from '@/services/ai.service';
import { listCategories } from '@/services/categories.service';
import { listTags } from '@/services/transactions.service';

import { Composer } from './composer';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';

interface References {
  accounts: AccountWithBalanceDto[];
  categories: CategoryDto[];
  tags: string[];
}

/** Accounts, categories, and tags: names for drafts and the entry form that reviews them. */
const loadReferences = async (signal: AbortSignal): Promise<References> => {
  const [accounts, categories, tags] = await Promise.all([
    listAccounts('all', signal),
    listCategories(signal),
    listTags(signal),
  ]);
  return {
    accounts: accounts.accounts,
    categories: categories.categories,
    tags: tags.tags.map((entry) => entry.tag),
  };
};

function SuggestedQuestions({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
}): ReactNode {
  return (
    <section
      aria-labelledby="assistant-intro-heading"
      className="flex flex-col gap-4 rounded-2xl border border-dashed p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Sparkles aria-hidden="true" className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="assistant-intro-heading" className="font-medium">
            Ask about your money in plain words
          </h2>
          <p className="text-sm text-muted-foreground">
            The assistant looks up your accounts, transactions, budgets, bills, subscriptions, and
            goals, and explains what it finds. It can draft a transaction for you to check, but it
            never saves, moves, or changes anything.
          </p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">
        {SUGGESTED_QUESTIONS.map((question) => (
          <li key={question}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              className="h-auto min-h-11 text-left whitespace-normal sm:min-h-8"
              onClick={() => {
                onAsk(question);
              }}
            >
              {question}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The financial assistant. Questions go to the CalmCash API, which looks the answer up in the
 * person's own records and has a local model word it; the browser never talks to the model. The
 * open conversation lives in the URL (`?c=<id>`), so a refresh keeps it.
 */
export function AssistantPage(): ReactNode {
  const { user } = useSignedInSession();
  const timeZone = user.timezone;
  const params = useSearchParams();
  const router = useRouter();
  const parsedId = entityIdSchema.safeParse(params.get('c'));
  const selectedId = parsedId.success ? parsedId.data : undefined;

  const select = useCallback(
    (conversationId: string | undefined) => {
      if (conversationId === undefined) {
        router.replace('/assistant', { scroll: false });
      } else {
        router.replace(`/assistant?c=${conversationId}`, { scroll: false });
      }
    },
    [router],
  );

  // A conversation started on this page is open at once, even before the URL catches up.
  const [startedId, setStartedId] = useState<string | undefined>();
  const activeId = selectedId ?? startedId;

  const status = useAiStatus();
  const conversations = useAsyncResource(listConversations);
  const detail = useAsyncResource(
    useCallback(
      async (signal: AbortSignal) =>
        activeId === undefined ? undefined : getConversation(activeId, signal),
      [activeId],
    ),
  );
  const refs = useAsyncResource(loadReferences);

  const [appended, setAppended] = useState<{
    conversationId: string;
    messages: ConversationMessageDto[];
  }>();
  const [pending, setPending] = useState<string | undefined>();
  const [question, setQuestion] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [entryMode, setEntryMode] = useState<EntrySheetMode | undefined>();
  const [listOpen, setListOpen] = useState(false);
  const [saved, setSaved] = useState<TransactionListItemDto | undefined>();

  const loaded =
    activeId !== undefined &&
    detail.state.status === 'success' &&
    detail.state.data?.conversation.id === activeId
      ? detail.state.data.messages
      : [];
  const extra =
    activeId !== undefined && appended?.conversationId === activeId
      ? appended.messages.filter((message) => !loaded.some((entry) => entry.id === message.id))
      : [];
  const messages = [...loaded, ...extra];

  const references = refs.state.status === 'success' ? refs.state.data : undefined;
  const names = useMemo<ReferenceNames | undefined>(
    () =>
      references === undefined
        ? undefined
        : {
            accounts: new Map(
              references.accounts.map((entry) => [entry.account.id, entry.account.name]),
            ),
            categories: new Map(references.categories.map((entry) => [entry.id, entry.name])),
          },
    [references],
  );

  const unavailable =
    status.state.status === 'success' && !status.state.data.available
      ? describeAiProblem(status.state.data.problem ?? 'unreachable', status.state.data.model)
      : undefined;
  const switchedOff =
    status.state.status === 'success' && status.state.data.problem === 'disabled_by_user';

  const ask = async (text: string): Promise<void> => {
    setProblem(undefined);
    setSaved(undefined);
    setPending(text);
    setQuestion('');
    try {
      const conversationId = activeId ?? (await createConversation()).id;
      if (conversationId !== activeId) {
        setStartedId(conversationId);
        select(conversationId);
      }
      const result = await sendMessage(conversationId, text);
      setAppended((current) => ({
        conversationId,
        messages: [
          ...(current?.conversationId === conversationId ? current.messages : []),
          result.userMessage,
          result.assistantMessage,
        ],
      }));
      conversations.refresh();
    } catch (error: unknown) {
      setProblem(describeRequestError(error));
      setQuestion(text); // Nothing typed is lost; the person can simply send it again.
      if (
        error instanceof ApiClientError &&
        (error.code === 'AI_UNAVAILABLE' || error.code === 'AI_DISABLED')
      ) {
        invalidateAiStatus();
        status.refresh();
      }
    } finally {
      setPending(undefined);
    }
  };

  const busy = pending !== undefined;
  const canAsk = unavailable === undefined && !busy;

  const list = (
    <ConversationList
      conversations={conversations.state.status === 'success' ? conversations.state.data.items : []}
      selectedId={activeId}
      timeZone={timeZone}
      onSelect={(conversationId) => {
        setProblem(undefined);
        setListOpen(false);
        setStartedId(undefined);
        select(conversationId);
      }}
      onNew={() => {
        setProblem(undefined);
        setListOpen(false);
        setStartedId(undefined);
        select(undefined);
      }}
      onRename={async (conversationId, title) => {
        try {
          await renameConversation(conversationId, title);
          conversations.refresh();
          if (conversationId === activeId) detail.refresh();
        } catch (error: unknown) {
          setProblem(describeRequestError(error));
        }
      }}
      onDelete={async (conversationId) => {
        try {
          await deleteConversation(conversationId);
          if (conversationId === activeId) {
            setStartedId(undefined);
            select(undefined);
          }
          conversations.refresh();
        } catch (error: unknown) {
          setProblem(describeRequestError(error));
        }
      }}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assistant"
        description="Questions about your own money, answered from your CalmCash records."
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-11 lg:hidden"
            onClick={() => {
              setListOpen(true);
            }}
          >
            <MessagesSquare aria-hidden="true" />
            Conversations
          </Button>
        }
      />

      {unavailable !== undefined && (
        <FormMessage tone="info" title="The assistant cannot answer right now">
          <p>{unavailable}</p>
          <p className="mt-1">
            Everything else in CalmCash works as usual, and your earlier conversations stay
            readable.
            {switchedOff && (
              <>
                {' '}
                <Link
                  href={{ pathname: '/settings', hash: 'ai' }}
                  className="font-medium underline"
                >
                  Open AI settings
                </Link>
              </>
            )}
          </p>
        </FormMessage>
      )}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          {conversations.state.status === 'loading' ? <ListSkeleton rows={4} /> : list}
        </aside>

        <section
          aria-label="Current conversation"
          className="flex min-h-[50vh] min-w-0 flex-col gap-5"
        >
          {activeId !== undefined && detail.state.status === 'error' ? (
            <ErrorState
              title="This conversation could not be opened"
              description={describeRequestError(detail.state.error)}
              onRetry={detail.reload}
            />
          ) : activeId !== undefined &&
            loaded.length === 0 &&
            extra.length === 0 &&
            !busy &&
            detail.state.status === 'loading' ? (
            <ListSkeleton rows={3} />
          ) : messages.length === 0 && !busy ? (
            <SuggestedQuestions disabled={!canAsk} onAsk={(text) => void ask(text)} />
          ) : (
            <MessageThread
              messages={messages}
              pending={pending}
              timeZone={timeZone}
              names={names}
              onAsk={canAsk ? (text) => void ask(text) : undefined}
              onReviewDraft={
                references === undefined
                  ? undefined
                  : (result) => {
                      setSaved(undefined);
                      setEntryMode({
                        kind: 'create',
                        type: result.draft.type,
                        prefill: prefillFromDraft(result),
                      });
                    }
              }
            />
          )}

          {problem !== undefined && (
            <FormMessage tone="error" title="That did not work">
              {problem}
            </FormMessage>
          )}
          {saved !== undefined && (
            <FormMessage tone="success" title="Transaction saved">
              <Link
                href={{ pathname: '/transactions', query: { transaction: saved.transaction.id } }}
                className="font-medium underline"
              >
                View it in Transactions
              </Link>
            </FormMessage>
          )}

          <div className="sticky bottom-[calc(var(--bottom-nav-height,0px)+0.75rem)] z-10 mt-auto bg-background pt-2 md:bottom-4">
            <Composer
              value={question}
              onChange={setQuestion}
              onSend={(text) => void ask(text)}
              busy={busy}
              disabledReason={unavailable}
            />
          </div>
        </section>
      </div>

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="w-full gap-0 overflow-y-auto sm:max-w-sm">
          <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
            <SheetTitle>Conversations</SheetTitle>
            <SheetDescription>Kept in your account until you delete them.</SheetDescription>
          </SheetHeader>
          <div className="p-4">{list}</div>
        </SheetContent>
      </Sheet>

      {references !== undefined && (
        <TransactionEntrySheet
          mode={entryMode}
          accounts={references.accounts}
          categories={references.categories}
          tagSuggestions={references.tags}
          timeZone={timeZone}
          defaultCurrency={user.preferredCurrency}
          onModeChange={setEntryMode}
          onClose={() => {
            setEntryMode(undefined);
          }}
          onSaved={(item) => {
            setEntryMode(undefined);
            setSaved(item);
            refs.refresh();
          }}
        />
      )}
    </div>
  );
}
