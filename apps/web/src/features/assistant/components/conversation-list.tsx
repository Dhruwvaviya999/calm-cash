'use client';

import { AI_TEXT_LIMITS, type ConversationDto } from '@calmcash/shared';
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ConversationListProps {
  conversations: readonly ConversationDto[];
  selectedId: string | undefined;
  timeZone: string;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}

function ConversationItem({
  conversation,
  selected,
  timeZone,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationDto;
  selected: boolean;
  timeZone: string;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [confirming, setConfirming] = useState(false);

  const save = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === '' || trimmed === conversation.title) {
      setEditing(false);
      setTitle(conversation.title);
      return;
    }
    await onRename(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex items-center gap-1 px-1 py-1">
        <Input
          aria-label="Conversation title"
          autoFocus
          maxLength={AI_TEXT_LIMITS.conversationTitle}
          className="h-11 sm:h-8"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
            if (event.key === 'Escape') {
              setEditing(false);
              setTitle(conversation.title);
            }
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Save title"
          className="size-11 sm:size-8"
          onClick={() => void save()}
        >
          <Check aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel renaming"
          className="size-11 sm:size-8"
          onClick={() => {
            setEditing(false);
            setTitle(conversation.title);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
          selected && 'bg-accent text-accent-foreground',
        )}
      >
        <span className="w-full truncate font-medium">{conversation.title}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(conversation.updatedAt, 'dayMonthYear', timeZone)}
        </span>
      </button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Rename ${conversation.title}`}
        className="size-11 sm:size-8"
        onClick={() => {
          setEditing(true);
        }}
      >
        <Pencil aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${conversation.title}`}
        className="size-11 sm:size-8"
        onClick={() => {
          setConfirming(true);
        }}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this conversation?"
        description="Its questions and answers are removed for good. Your financial records are not affected."
        confirmLabel="Delete conversation"
        destructive
        onConfirm={() => void onDelete()}
      />
    </li>
  );
}

/** The person's conversations, newest first, with rename and delete. */
export function ConversationList({
  conversations,
  selectedId,
  timeZone,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ConversationListProps): ReactNode {
  return (
    <nav aria-label="Conversations" className="flex flex-col gap-3">
      <Button type="button" variant="outline" className="h-11 justify-start sm:h-9" onClick={onNew}>
        <MessageSquarePlus aria-hidden="true" />
        New conversation
      </Button>
      {conversations.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={conversation.id === selectedId}
              timeZone={timeZone}
              onSelect={() => {
                onSelect(conversation.id);
              }}
              onRename={(title) => onRename(conversation.id, title)}
              onDelete={() => onDelete(conversation.id)}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}
