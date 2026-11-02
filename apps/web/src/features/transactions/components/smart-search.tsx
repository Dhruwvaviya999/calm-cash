'use client';

import {
  AI_TEXT_LIMITS,
  type FilterChipDto,
  type SearchInterpretationDto,
  type TransactionLinkFilters,
} from '@calmcash/shared';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAiStatus } from '@/features/ai/use-ai-status';
import { describeRequestError } from '@/lib/form-errors';
import { interpretSearch } from '@/services/ai.service';

import { DEFAULT_FILTERS, type TransactionFilters } from '../transaction-filters';

/** The list filters for an interpreted question (everything else back to its default). */
export function filtersFromInterpretation(
  filters: TransactionLinkFilters,
  sort: TransactionFilters['sort'],
): TransactionFilters {
  return {
    ...DEFAULT_FILTERS,
    q: filters.q ?? '',
    type: filters.type,
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    currency: filters.currency,
    from: filters.from,
    to: filters.to,
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
    sort: filters.sort ?? sort,
  };
}

const FILTER_KEYS = [
  'type',
  'accountId',
  'categoryId',
  'currency',
  'from',
  'to',
  'q',
  'minAmount',
  'maxAmount',
  'sort',
] as const satisfies readonly (keyof TransactionLinkFilters)[];

function copyFilter<K extends keyof TransactionLinkFilters>(
  target: TransactionLinkFilters,
  key: K,
  value: TransactionLinkFilters[K],
): void {
  if (value !== undefined) target[key] = value;
}

/** The filters without the parts the person removed (a date chip covers both ends). */
export function withoutChips(
  filters: TransactionLinkFilters,
  removed: ReadonlySet<FilterChipDto['key']>,
): TransactionLinkFilters {
  const kept: TransactionLinkFilters = {};
  for (const key of FILTER_KEYS) {
    const dropped = removed.has(key) || (key === 'to' && removed.has('from'));
    if (!dropped) copyFilter(kept, key, filters[key]);
  }
  return kept;
}

type Interpretation = Extract<SearchInterpretationDto, { kind: 'filters' }>;

/**
 * "Food expenses above 2000 last month" → ordinary filters, shown as chips to check (and remove)
 * before they are applied. The filters are the list's own, so the results are exactly what the
 * filter sheet would show. Hidden while AI is unavailable or switched off.
 */
export function SmartSearch({
  sort,
  onApply,
}: {
  sort: TransactionFilters['sort'];
  onApply: (filters: TransactionFilters) => void;
}): ReactNode {
  const { state } = useAiStatus();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [result, setResult] = useState<Interpretation | undefined>();
  const [removed, setRemoved] = useState<ReadonlySet<FilterChipDto['key']>>(new Set());

  if (state.status !== 'success' || !state.data.available) return null;

  if (!open) {
    return (
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-11 sm:h-8"
          onClick={() => {
            setOpen(true);
          }}
        >
          <Sparkles aria-hidden="true" />
          Search in plain words
        </Button>
      </div>
    );
  }

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const query = text.trim();
    if (query.length < 2 || busy) return;
    setBusy(true);
    setMessage(undefined);
    setResult(undefined);
    setRemoved(new Set());
    try {
      const interpretation = await interpretSearch(query);
      if (interpretation.kind === 'not_understood') {
        setMessage(interpretation.reason);
      } else {
        setResult(interpretation);
      }
    } catch (error: unknown) {
      setMessage(describeRequestError(error));
    } finally {
      setBusy(false);
    }
  };

  const chips = result?.chips.filter((chip) => !removed.has(chip.key)) ?? [];

  return (
    <section
      aria-label="Search in plain words"
      className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium">
          <Sparkles aria-hidden="true" className="size-4 text-primary" />
          Describe what you are looking for
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            autoComplete="off"
            maxLength={AI_TEXT_LIMITS.searchQuery}
            placeholder="e.g. Food expenses above 2000 last month"
            className="h-11 sm:h-9"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="secondary"
              className="h-11 flex-1 sm:h-9"
              disabled={busy || text.trim().length < 2}
            >
              {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {busy ? 'Reading…' : 'Find filters'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close plain-word search"
              className="size-11 sm:size-9"
              onClick={() => {
                setOpen(false);
                setResult(undefined);
                setMessage(undefined);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>

      <div aria-live="polite" className="flex flex-col gap-2">
        {message !== undefined && <p className="text-sm text-muted-foreground">{message}</p>}
        {result !== undefined && (
          <>
            <p className="text-sm">Check these filters, remove any you do not want, then apply:</p>
            {chips.length > 0 ? (
              <ul aria-label="Suggested filters" className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <li key={chip.key}>
                    <span className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border bg-background pr-1 pl-3 text-sm">
                      <span className="truncate">{chip.label}</span>
                      <button
                        type="button"
                        aria-label={`Remove suggested filter ${chip.label}`}
                        onClick={() => {
                          setRemoved((current) => new Set([...current, chip.key]));
                        }}
                        className="grid size-6 place-items-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No filters left to apply.</p>
            )}
            {result.unresolved.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Not found in your categories or accounts:{' '}
                {result.unresolved.map((name) => `“${name}”`).join(', ')}.
              </p>
            )}
            <div>
              <Button
                type="button"
                className="h-11 sm:h-9"
                disabled={chips.length === 0}
                onClick={() => {
                  onApply(filtersFromInterpretation(withoutChips(result.filters, removed), sort));
                  setResult(undefined);
                  setOpen(false);
                }}
              >
                Apply filters
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
