'use client';

import { AI_TEXT_LIMITS, type TransactionDraftResultDto } from '@calmcash/shared';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAiStatus } from '@/features/ai/use-ai-status';
import { describeRequestError } from '@/lib/form-errors';
import { draftTransaction } from '@/services/ai.service';

export type DraftResult = Exclude<TransactionDraftResultDto, { kind: 'not_a_transaction' }>;

/**
 * "Spent 450 on dinner yesterday from HDFC" → the form below, filled in. The assistant only
 * proposes values; the person checks them and saves the ordinary form. Hidden while AI is
 * unavailable or switched off, so the form works exactly as before. It lives inside the
 * transaction form, so it is a group with its own button rather than a nested form.
 */
export function DescribeIt({ onDraft }: { onDraft: (result: DraftResult) => void }): ReactNode {
  const { state } = useAiStatus();
  const inputId = useId();
  const hintId = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  if (state.status !== 'success' || !state.data.available) return null;

  const fillIn = async (): Promise<void> => {
    const sentence = text.trim();
    if (sentence.length < 3 || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await draftTransaction(sentence);
      if (result.kind === 'not_a_transaction') {
        setMessage(result.reason);
      } else {
        onDraft(result);
        setMessage('Filled in below. Check every field before you save.');
      }
    } catch (error: unknown) {
      setMessage(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="Fill in from a description"
      className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-3"
    >
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium">
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        Describe it in your words (optional)
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          autoComplete="off"
          aria-describedby={hintId}
          maxLength={AI_TEXT_LIMITS.draftText}
          placeholder="e.g. Spent 450 on dinner at Swiggy yesterday from HDFC"
          className="h-11 sm:h-9"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter fills in the form instead of submitting the transaction.
            if (event.key === 'Enter') {
              event.preventDefault();
              void fillIn();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className="h-11 sm:h-9"
          disabled={busy || text.trim().length < 3}
          onClick={() => void fillIn()}
        >
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {busy ? 'Reading…' : 'Fill in the form'}
        </Button>
      </div>
      <p id={hintId} aria-live="polite" className="text-xs text-muted-foreground">
        {message ?? 'Runs on your own computer. Nothing is saved until you add the transaction.'}
      </p>
    </div>
  );
}
