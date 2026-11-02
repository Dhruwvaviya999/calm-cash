'use client';

import { AI_TEXT_LIMITS } from '@calmcash/shared';
import { LoaderCircle, SendHorizontal } from 'lucide-react';
import { useId, type ReactNode, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (question: string) => void;
  busy: boolean;
  /** Why questions cannot be sent right now; `undefined` when they can. */
  disabledReason: string | undefined;
}

/**
 * The question box. Enter sends, Shift+Enter starts a new line. It stays above the mobile bottom
 * bar and the on-screen keyboard because the page scrolls the thread, not the box.
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  disabledReason,
}: ComposerProps): ReactNode {
  const inputId = useId();
  const hintId = useId();
  const question = value.trim();
  const blocked = disabledReason !== undefined;

  const submit = (): void => {
    if (question === '' || busy || blocked) return;
    onSend(question);
  };

  return (
    <form
      noValidate
      aria-label="Ask the assistant"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor={inputId} className="sr-only">
        Your question
      </label>
      <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring/50">
        <Textarea
          id={inputId}
          rows={1}
          aria-describedby={hintId}
          maxLength={AI_TEXT_LIMITS.message}
          disabled={blocked}
          placeholder={blocked ? 'The assistant is not available' : 'Ask about your money…'}
          className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={busy ? 'Waiting for the answer' : 'Send question'}
          className="size-11 shrink-0 rounded-xl"
          disabled={busy || blocked || question === ''}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" />
          )}
        </Button>
      </div>
      <p id={hintId} className="px-1 text-xs text-muted-foreground">
        {disabledReason ??
          'Answers come from your own records, computed by CalmCash; the assistant runs on this server and never changes anything.'}
      </p>
    </form>
  );
}
