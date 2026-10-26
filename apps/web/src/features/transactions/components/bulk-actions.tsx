'use client';

import type { BulkTransactionInput, CategoryDto } from '@calmcash/shared';
import { Ban, FolderInput, LoaderCircle, Tag, Tags, X } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { CategorySelect } from './category-select';
import { TagInput } from './tag-input';

export type BulkEditAction = 'set_category' | 'add_tags' | 'remove_tags';

export interface BulkActionBarProps {
  count: number;
  onAction: (action: BulkEditAction | 'void') => void;
  onDone: () => void;
}

/** Actions for the selected transactions; sticks to the bottom of the screen while selecting. */
export function BulkActionBar({ count, onAction, onDone }: BulkActionBarProps): ReactNode {
  const disabled = count === 0;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky bottom-[calc(var(--bottom-nav-height,0px)+0.75rem)] z-20 flex flex-wrap items-center gap-2 rounded-2xl border bg-popover p-3 shadow-lg md:bottom-4"
    >
      <p className="mr-auto text-sm font-medium" aria-live="polite">
        {count} selected
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-10"
        disabled={disabled}
        onClick={() => {
          onAction('set_category');
        }}
      >
        <FolderInput aria-hidden="true" />
        Categorise
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-10"
        disabled={disabled}
        onClick={() => {
          onAction('add_tags');
        }}
      >
        <Tag aria-hidden="true" />
        Add tags
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-10"
        disabled={disabled}
        onClick={() => {
          onAction('remove_tags');
        }}
      >
        <Tags aria-hidden="true" />
        Remove tags
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-10"
        disabled={disabled}
        onClick={() => {
          onAction('void');
        }}
      >
        <Ban aria-hidden="true" />
        Void
      </Button>
      <Button variant="ghost" size="sm" className="h-10" onClick={onDone}>
        <X aria-hidden="true" />
        Done
      </Button>
    </div>
  );
}

const TITLES: Readonly<Record<BulkEditAction, string>> = {
  set_category: 'Categorise transactions',
  add_tags: 'Add tags',
  remove_tags: 'Remove tags',
};

export interface BulkEditSheetProps {
  action: BulkEditAction | undefined;
  transactionIds: readonly string[];
  categories: readonly CategoryDto[];
  tagSuggestions: readonly string[];
  /** Applies the change; rejects with the API error, which is shown here. */
  onSubmit: (input: BulkTransactionInput) => Promise<void>;
  onClose: () => void;
  describeError: (error: unknown) => string;
}

function BulkEditor({
  action,
  transactionIds,
  categories,
  tagSuggestions,
  onSubmit,
  onClose,
  describeError,
}: Omit<BulkEditSheetProps, 'action'> & { action: BulkEditAction }): ReactNode {
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const submit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const ids = [...transactionIds];
    let input: BulkTransactionInput;
    if (action === 'set_category') {
      if (categoryId === '') {
        setFailure('Choose a category.');
        return;
      }
      input = { action, transactionIds: ids, categoryId };
    } else {
      if (tags.length === 0) {
        setFailure('Enter at least one tag.');
        return;
      }
      input = { action, transactionIds: ids, tags };
    }
    setBusy(true);
    setFailure(undefined);
    try {
      await onSubmit(input);
    } catch (error: unknown) {
      setFailure(describeError(error));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      aria-label={TITLES[action]}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-5"
    >
      {action === 'set_category' ? (
        <FormField
          id="bulk-category"
          label="Category"
          hint="Only income and expenses have categories; choose one of the matching kind."
        >
          {(control) => (
            <CategorySelect
              {...control}
              categories={categories}
              placeholder="Choose a category"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
              }}
            />
          )}
        </FormField>
      ) : (
        <FormField id="bulk-tags" label="Tags" hint="Press Enter after each tag.">
          {(control) => (
            <TagInput
              control={control}
              tags={tags}
              suggestions={tagSuggestions}
              onChange={setTags}
            />
          )}
        </FormField>
      )}
      {failure !== undefined && (
        <FormMessage tone="error" title="Nothing was changed">
          {failure}
        </FormMessage>
      )}
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={busy}>
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          Apply to {transactionIds.length}
        </Button>
      </div>
    </form>
  );
}

/** Categorise, tag, or untag the selected transactions: all of them, or none if any fails. */
export function BulkEditSheet({ action, ...props }: BulkEditSheetProps): ReactNode {
  return (
    <Sheet
      open={action !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
          <SheetTitle className="text-lg">
            {action === undefined ? 'Bulk edit' : TITLES[action]}
          </SheetTitle>
          <SheetDescription>
            Applies to {props.transactionIds.length} selected transactions, or to none if any of
            them cannot change.
          </SheetDescription>
        </SheetHeader>
        <div className="px-5 py-5">
          {action !== undefined && <BulkEditor key={action} action={action} {...props} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
