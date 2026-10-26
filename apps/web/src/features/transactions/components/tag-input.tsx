'use client';

import { isValidTag, MAX_TAGS_PER_TRANSACTION, normalizeTag, TEXT_LIMITS } from '@calmcash/shared';
import { X } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { FieldControlProps } from '@/components/forms/form-field';
import { Input } from '@/components/ui/input';

export interface TagInputProps {
  control: FieldControlProps;
  /** Normalised tags. */
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  /** Tags already in use, offered as suggestions. */
  suggestions: readonly string[];
}

/**
 * Tags as removable chips plus a text field. Enter, comma, or leaving the field adds what was
 * typed; tags are normalised as the API does ("Work Trip" becomes "work-trip").
 */
export function TagInput({ control, tags, onChange, suggestions }: TagInputProps): ReactNode {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const listId = useId();
  const full = tags.length >= MAX_TAGS_PER_TRANSACTION;

  const commit = (): void => {
    const tag = normalizeTag(draft);
    if (tag === '') {
      setDraft('');
      return;
    }
    if (!isValidTag(tag)) {
      setProblem('Use letters, digits, hyphens, and underscores, starting with a letter or digit.');
      return;
    }
    if (!tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setDraft('');
    setProblem(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <span className="inline-flex h-8 items-center gap-1 rounded-full border bg-muted/60 pr-1 pl-3 text-sm">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => {
                    onChange(tags.filter((entry) => entry !== tag));
                  }}
                  className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Input
        {...control}
        list={listId}
        value={draft}
        disabled={full}
        maxLength={TEXT_LIMITS.transactionTag + 8}
        autoComplete="off"
        enterKeyHint="done"
        placeholder={full ? 'Tag limit reached' : 'e.g. work, family, reimbursable'}
        className="h-11"
        onChange={(event) => {
          setProblem(undefined);
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
      <datalist id={listId}>
        {suggestions
          .filter((suggestion) => !tags.includes(suggestion))
          .map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
      </datalist>
      {problem !== undefined && (
        <p role="alert" className="text-sm text-expense">
          {problem}
        </p>
      )}
    </div>
  );
}
