'use client';

import type { ConversationMessageDto } from '@calmcash/shared';
import { Bot, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { Button } from '@/components/ui/button';
import {
  AssistantBlocks,
  type AssistantBlocksProps,
  type ReferenceNames,
} from '@/features/ai/components/assistant-blocks';
import { formatDateTime } from '@/lib/format';

export interface MessageThreadProps {
  messages: readonly ConversationMessageDto[];
  /** The question being answered right now, shown until the answer arrives. */
  pending: string | undefined;
  timeZone: string;
  names: ReferenceNames | undefined;
  onReviewDraft: AssistantBlocksProps['onReviewDraft'];
  /** Asks a follow-up question; absent while a question cannot be sent. */
  onAsk: ((question: string) => void) | undefined;
}

function UserBubble({ content }: { content: string }): ReactNode {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm break-words whitespace-pre-wrap text-primary-foreground">
        <span className="sr-only">You asked: </span>
        {content}
      </p>
    </div>
  );
}

function AssistantMessage({
  message,
  timeZone,
  names,
  onReviewDraft,
  followUps,
}: {
  message: ConversationMessageDto;
  timeZone: string;
  names: ReferenceNames | undefined;
  onReviewDraft: AssistantBlocksProps['onReviewDraft'];
  followUps: ReactNode;
}): ReactNode {
  return (
    <article
      aria-label={`Answer from ${formatDateTime(message.createdAt, timeZone)}`}
      className="flex gap-3"
    >
      <span
        aria-hidden="true"
        className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground"
      >
        <Bot className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl rounded-tl-md border bg-card px-4 py-3">
        <p className="text-sm break-words whitespace-pre-wrap">{message.content}</p>
        <AssistantBlocks
          blocks={message.blocks}
          timeZone={timeZone}
          names={names}
          onReviewDraft={onReviewDraft}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {message.outcome === 'unsupported' && (
            <StatusBadge tone="neutral">Outside what the assistant does</StatusBadge>
          )}
          {message.outcome === 'clarification' && (
            <StatusBadge tone="info">Needs a little more detail</StatusBadge>
          )}
          {message.blocks.some((block) => block.kind !== 'links' && block.kind !== 'notice') && (
            <span>Figures come straight from your CalmCash records.</span>
          )}
          {message.narrative === 'template' && message.outcome === 'answered' && (
            <span>Standard summary wording.</span>
          )}
        </div>
        {followUps}
      </div>
    </article>
  );
}

/** The conversation so far: the person's questions and the assistant's answers. */
export function MessageThread({
  messages,
  pending,
  timeZone,
  names,
  onReviewDraft,
  onAsk,
}: MessageThreadProps): ReactNode {
  const lastAssistant = messages.filter((message) => message.role === 'assistant').at(-1);
  return (
    <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-5">
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserBubble key={message.id} content={message.content} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            timeZone={timeZone}
            names={names}
            onReviewDraft={onReviewDraft}
            followUps={
              message.id === lastAssistant?.id &&
              pending === undefined &&
              onAsk !== undefined &&
              message.followUps.length > 0 ? (
                <div className="flex flex-wrap gap-2" aria-label="Suggested follow-up questions">
                  {message.followUps.map((question) => (
                    <Button
                      key={question}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-auto min-h-11 text-left whitespace-normal sm:min-h-8"
                      onClick={() => {
                        onAsk(question);
                      }}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
              ) : null
            }
          />
        ),
      )}
      {pending !== undefined && (
        <>
          <UserBubble content={pending} />
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Looking at your records… A small local model can take up to a minute.
          </p>
        </>
      )}
    </div>
  );
}
