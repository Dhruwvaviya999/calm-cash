'use client';

import {
  AI_LIMITS,
  type CategoryDto,
  type CategorySuggestionDto,
  type MerchantSuggestionDto,
  type TransactionListItemDto,
} from '@calmcash/shared';
import { Check, LoaderCircle, Store, Tags, X } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/error-state';
import { ListSkeleton } from '@/components/feedback/loading-skeleton';
import {
  FinancialAmount,
  directionForTransactionType,
} from '@/components/finance/financial-amount';
import { FormMessage } from '@/components/forms/form-message';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSignedInSession } from '@/features/auth';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatDate } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import {
  dismissMerchantSuggestion,
  getMerchantSuggestions,
  rejectCategorySuggestion,
  saveMerchantRule,
  suggestCategories,
} from '@/services/ai.service';
import { listCategories } from '@/services/categories.service';
import { listTransactions, updateTransaction } from '@/services/transactions.service';

type Notice = { tone: 'success' | 'error'; message: string } | undefined;

const BASIS_LABELS = {
  your_history: 'From your earlier choices',
  assistant: 'Assistant suggestion',
  your_rule: 'Your rule',
  pattern: 'From the description',
} as const;

interface Uncategorised {
  items: TransactionListItemDto[];
  categories: CategoryDto[];
}

/** Recent income and expenses without a category (e.g. from statement imports). */
const loadUncategorised = async (signal: AbortSignal): Promise<Uncategorised> => {
  const [page, categories] = await Promise.all([
    listTransactions('sort=newest&page=1&pageSize=100', signal),
    listCategories(signal),
  ]);
  return {
    items: page.items.filter(
      ({ transaction }) =>
        (transaction.type === 'income' || transaction.type === 'expense') &&
        transaction.categoryId === undefined,
    ),
    categories: categories.categories,
  };
};

function TransactionSummary({
  item,
  timeZone,
}: {
  item: TransactionListItemDto;
  timeZone: string;
}): ReactNode {
  const { transaction } = item;
  return (
    <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{transaction.description}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(transaction.occurredAt, 'dayMonthYear', timeZone)}
        </span>
      </span>
      <FinancialAmount
        amountMinor={transaction.amountMinor}
        currency={transaction.currency}
        size="sm"
        direction={
          transaction.type === 'balance_adjustment'
            ? 'balance'
            : directionForTransactionType(transaction.type)
        }
      />
    </span>
  );
}

function CategoryReview({ timeZone }: { timeZone: string }): ReactNode {
  const data = useAsyncResource(loadUncategorised);
  const [suggestions, setSuggestions] = useState<ReadonlyMap<string, CategorySuggestionDto>>(
    new Map(),
  );
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());

  if (data.state.status === 'loading') return <ListSkeleton rows={2} />;
  if (data.state.status === 'error') {
    return (
      <ErrorState
        title="Transactions without a category could not be loaded"
        description={describeRequestError(data.state.error)}
        onRetry={data.reload}
      />
    );
  }
  const { items, categories } = data.state.data;
  const batch = items.slice(0, AI_LIMITS.categorizeBatch);
  const nameOf = (categoryId: string): string =>
    categories.find((category) => category.id === categoryId)?.name ?? 'a category';
  const acceptable = batch.filter(
    (item) => suggestions.get(item.transaction.id)?.categoryId !== undefined,
  );

  const mark = (transactionId: string, busy: boolean): void => {
    setWorking((current) => {
      const next = new Set(current);
      if (busy) next.add(transactionId);
      else next.delete(transactionId);
      return next;
    });
  };

  const ask = async (): Promise<void> => {
    setAsking(true);
    setNotice(undefined);
    try {
      const result = await suggestCategories(batch.map((item) => item.transaction.id));
      setSuggestions(new Map(result.items.map((item) => [item.transactionId, item])));
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
    } finally {
      setAsking(false);
    }
  };

  const accept = async (transactionId: string, categoryId: string): Promise<boolean> => {
    mark(transactionId, true);
    try {
      await updateTransaction(transactionId, { categoryId });
      return true;
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
      return false;
    } finally {
      mark(transactionId, false);
    }
  };

  const acceptAll = async (): Promise<void> => {
    setNotice(undefined);
    let saved = 0;
    for (const item of acceptable) {
      const categoryId = suggestions.get(item.transaction.id)?.categoryId;
      if (categoryId !== undefined && (await accept(item.transaction.id, categoryId))) saved += 1;
    }
    setSuggestions(new Map());
    data.refresh();
    if (saved > 0) {
      setNotice({
        tone: 'success',
        message: `Categorised ${saved.toString()} ${saved === 1 ? 'transaction' : 'transactions'}.`,
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <Tags aria-hidden="true" className="size-4 text-muted-foreground" />
          Transactions without a category
        </h3>
        {batch.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-11 sm:h-8"
              disabled={asking}
              onClick={() => void ask()}
            >
              {asking && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              Suggest categories
            </Button>
            {acceptable.length > 1 && (
              <Button
                type="button"
                size="sm"
                className="h-11 sm:h-8"
                disabled={working.size > 0}
                onClick={() => void acceptAll()}
              >
                Accept all {acceptable.length.toString()} suggestions
              </Button>
            )}
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every recent income and expense has a category.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {items.length > batch.length
              ? `Showing ${batch.length.toString()} of ${items.length.toString()} recent ones. `
              : ''}
            Suggestions use your earlier choices first. Nothing changes until you accept.
          </p>
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {batch.map((item) => {
              const suggestion = suggestions.get(item.transaction.id);
              const busy = working.has(item.transaction.id);
              return (
                <li key={item.transaction.id} className="flex flex-col gap-2 p-4">
                  <TransactionSummary item={item} timeZone={timeZone} />
                  {suggestion !== undefined && (
                    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 text-muted-foreground">
                        {suggestion.categoryId === undefined ? (
                          suggestion.reason
                        ) : (
                          <>
                            <span className="font-medium text-foreground">
                              {nameOf(suggestion.categoryId)}
                            </span>{' '}
                            — {suggestion.reason}
                            {suggestion.basis === undefined
                              ? ''
                              : ` (${BASIS_LABELS[suggestion.basis]})`}
                          </>
                        )}
                      </p>
                      {suggestion.categoryId !== undefined && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="h-11 sm:h-8"
                            disabled={busy}
                            onClick={() =>
                              void (async () => {
                                const categoryId = suggestion.categoryId;
                                if (categoryId === undefined) return;
                                if (await accept(item.transaction.id, categoryId)) data.refresh();
                              })()
                            }
                          >
                            <Check aria-hidden="true" />
                            Accept
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-11 sm:h-8"
                            disabled={busy}
                            onClick={() =>
                              void (async () => {
                                const categoryId = suggestion.categoryId;
                                if (categoryId === undefined) return;
                                try {
                                  await rejectCategorySuggestion(item.transaction.id, categoryId);
                                  setSuggestions((current) => {
                                    const next = new Map(current);
                                    next.delete(item.transaction.id);
                                    return next;
                                  });
                                } catch (error: unknown) {
                                  setNotice({
                                    tone: 'error',
                                    message: describeRequestError(error),
                                  });
                                }
                              })()
                            }
                          >
                            <X aria-hidden="true" />
                            Not this
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
    </div>
  );
}

function MerchantSuggestion({
  suggestion,
  onDone,
  onFailure,
}: {
  suggestion: MerchantSuggestionDto;
  onDone: () => void;
  onFailure: (message: string) => void;
}): ReactNode {
  const [name, setName] = useState(suggestion.suggestedMerchant);
  const [busy, setBusy] = useState(false);
  const merchant = name.trim();

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (error: unknown) {
      onFailure(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 p-4">
      <p className="text-sm break-all">
        <span className="text-muted-foreground">Bank text: </span>
        {suggestion.description}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={`merchant-${suggestion.transactionId}`}>
          Merchant name for {suggestion.description}
        </label>
        <Input
          id={`merchant-${suggestion.transactionId}`}
          className="h-11 sm:h-8 sm:max-w-56"
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <span className="text-xs text-muted-foreground">{BASIS_LABELS[suggestion.basis]}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-11 sm:h-8"
          disabled={busy || merchant === ''}
          onClick={() => void run(() => updateTransaction(suggestion.transactionId, { merchant }))}
        >
          Use this name
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={busy || merchant === ''}
          onClick={() =>
            void run(async () => {
              await saveMerchantRule({ patternKey: suggestion.patternKey, merchant });
              await updateTransaction(suggestion.transactionId, { merchant });
            })
          }
        >
          Always use this name
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={busy}
          onClick={() => void run(() => dismissMerchantSuggestion(suggestion.transactionId))}
        >
          Dismiss
        </Button>
      </div>
    </li>
  );
}

function MerchantReview(): ReactNode {
  const [requested, setRequested] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const suggestions = useAsyncResource(
    useCallback(
      async (signal: AbortSignal) => (requested ? getMerchantSuggestions(signal) : undefined),
      [requested],
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <Store aria-hidden="true" className="size-4 text-muted-foreground" />
          Readable merchant names
        </h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11 sm:h-8"
          disabled={requested && suggestions.state.status === 'loading'}
          onClick={() => {
            setNotice(undefined);
            if (requested) suggestions.reload();
            else setRequested(true);
          }}
        >
          {requested && suggestions.state.status === 'loading' && (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          )}
          {requested ? 'Check again' : 'Find readable names'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Turns bank text such as “UPI/RAHUL123/…” into a short name. The bank text itself is always
        kept.
      </p>
      {requested && suggestions.state.status === 'error' && (
        <ErrorState
          title="Merchant names could not be suggested"
          description={describeRequestError(suggestions.state.error)}
          onRetry={suggestions.reload}
        />
      )}
      {suggestions.state.status === 'success' &&
        suggestions.state.data !== undefined &&
        (suggestions.state.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No suggestions right now.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {suggestions.state.data.items.map((suggestion) => (
              <MerchantSuggestion
                key={suggestion.transactionId}
                suggestion={suggestion}
                onDone={suggestions.refresh}
                onFailure={(message) => {
                  setNotice({ tone: 'error', message });
                }}
              />
            ))}
          </ul>
        ))}
      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}
    </div>
  );
}

/** Category and merchant suggestions for recent transactions; each one waits for the person. */
export function TidyUp(): ReactNode {
  const { user } = useSignedInSession();
  return (
    <section aria-labelledby="tidy-up-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="tidy-up-heading"
        title="Tidy up"
        description="Suggestions for categories and merchant names. Accepting one edits that transaction; nothing changes otherwise."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryReview timeZone={user.timezone} />
        <MerchantReview />
      </div>
    </section>
  );
}
