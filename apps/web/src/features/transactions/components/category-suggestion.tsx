'use client';

import type { CategoryDto, CategorySuggestionDto } from '@calmcash/shared';
import { LoaderCircle, Wand2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { describeRequestError } from '@/lib/form-errors';
import { suggestEntryCategory } from '@/services/ai.service';

type Suggestion = Omit<CategorySuggestionDto, 'transactionId'>;

/**
 * Suggests a category for what is being entered: first from the person's own earlier choices for
 * the same payee, then (when AI is on) from the assistant. A suggestion is only applied when the
 * person picks it.
 */
export function CategorySuggestion({
  type,
  description,
  merchant,
  categories,
  onUse,
}: {
  type: 'income' | 'expense';
  description: string;
  merchant: string;
  categories: readonly CategoryDto[];
  onUse: (categoryId: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const text = description.trim().length >= 2 ? description.trim() : merchant.trim();
  const suggested =
    suggestion?.categoryId === undefined
      ? undefined
      : categories.find((category) => category.id === suggestion.categoryId);

  const ask = async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    setSuggestion(undefined);
    try {
      setSuggestion(
        await suggestEntryCategory({
          type,
          description: text,
          ...(merchant.trim() === '' ? {} : { merchant: merchant.trim() }),
        }),
      );
    } catch (error: unknown) {
      setFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 text-sm" aria-live="polite">
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-11 sm:h-8"
          disabled={busy || text.length < 2}
          onClick={() => void ask()}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Wand2 aria-hidden="true" />
          )}
          Suggest a category
        </Button>
      </div>
      {failure !== undefined && <p className="text-expense">{failure}</p>}
      {suggestion !== undefined && suggested === undefined && (
        <p className="text-muted-foreground">{suggestion.reason}</p>
      )}
      {suggestion !== undefined && suggested !== undefined && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0">
            <span className="font-medium">{suggested.name}</span>
            <span className="text-muted-foreground">
              {' '}
              — {suggestion.reason}
              {suggestion.basis === 'assistant' ? ' (assistant suggestion)' : ''}
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => {
                onUse(suggested.id);
                setSuggestion(undefined);
              }}
            >
              Use {suggested.name}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 sm:h-8"
              onClick={() => {
                setSuggestion(undefined);
              }}
            >
              No thanks
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
