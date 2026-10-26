'use client';

import { createCategoryInputSchema, type CategoryDto, type CategoryKind } from '@calmcash/shared';
import { Archive, ArchiveRestore, Check, Pencil, Plus } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { StatusBadge } from '@/components/feedback/status-badge';
import { FilterOptions } from '@/components/forms/filter-bar';
import { FormField } from '@/components/forms/form-field';
import { FormMessage } from '@/components/forms/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { describeRequestError } from '@/lib/form-errors';
import {
  archiveCategory,
  createCategory,
  renameCategory,
  restoreCategory,
} from '@/services/categories.service';

export interface CategoryManagerSheetProps {
  open: boolean;
  categories: readonly CategoryDto[];
  /** Called after any change so the page reloads its categories. */
  onChanged: () => void;
  onClose: () => void;
}

const KIND_OPTIONS = [
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
] as const;

function CategoryItem({
  category,
  child,
  busy,
  onRename,
  onToggleArchived,
}: {
  category: CategoryDto;
  child: boolean;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onToggleArchived: () => void;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const archived = category.status === 'archived';

  return (
    <li className={child ? 'pl-6' : undefined}>
      <div className="flex min-h-12 items-center gap-2 py-1.5">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
              event.preventDefault();
              void onRename(name).then((done) => {
                if (done) {
                  setEditing(false);
                }
              });
            }}
          >
            <Input
              aria-label={`New name for ${category.name}`}
              value={name}
              autoFocus
              className="h-10"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Save name"
              className="size-10"
              disabled={busy}
            >
              <Check aria-hidden="true" />
            </Button>
          </form>
        ) : (
          <>
            <span
              className={
                child
                  ? 'min-w-0 flex-1 truncate text-sm'
                  : 'min-w-0 flex-1 truncate text-sm font-medium'
              }
            >
              {category.name}
            </span>
            {archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
            {!archived && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Rename ${category.name}`}
                className="size-10"
                onClick={() => {
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={archived ? `Restore ${category.name}` : `Archive ${category.name}`}
              className="size-10"
              disabled={busy}
              onClick={onToggleArchived}
            >
              {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Manager({
  categories,
  onChanged,
}: Omit<CategoryManagerSheetProps, 'open' | 'onClose'>): ReactNode {
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<
    { tone: 'success' | 'error'; message: string } | undefined
  >();

  const run = async (action: () => Promise<CategoryDto>, success: string): Promise<boolean> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice({ tone: 'success', message: success });
      onChanged();
      return true;
    } catch (error: unknown) {
      setNotice({ tone: 'error', message: describeRequestError(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = createCategoryInputSchema.safeParse({
      name,
      kind,
      ...(parentId === '' ? {} : { parentId }),
    });
    if (!parsed.success) {
      setNotice({ tone: 'error', message: parsed.error.issues[0]?.message ?? 'Check the name.' });
      return;
    }
    void run(() => createCategory(parsed.data), `${parsed.data.name} was added.`).then((done) => {
      if (done) {
        setName('');
        setParentId('');
      }
    });
  };

  const ofKind = categories.filter((category) => category.kind === kind);
  const parents = ofKind.filter((category) => category.parentId === undefined);

  return (
    <div className="flex flex-col gap-6">
      <FilterOptions
        legend="Category kind"
        name="category-kind"
        options={KIND_OPTIONS}
        value={kind}
        onValueChange={(next) => {
          setKind(next);
          setParentId('');
        }}
      />

      <form
        noValidate
        aria-label="Add a category"
        onSubmit={add}
        className="flex flex-col gap-3 rounded-xl border bg-card/60 p-4"
      >
        <FormField id="new-category-name" label="New category">
          {(control) => (
            <Input
              {...control}
              value={name}
              autoComplete="off"
              placeholder={kind === 'expense' ? 'e.g. Pets' : 'e.g. Rental income'}
              className="h-11"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField id="new-category-parent" label="Inside (optional)">
          {(control) => (
            <NativeSelect
              {...control}
              value={parentId}
              onChange={(event) => {
                setParentId(event.target.value);
              }}
            >
              <option value="">Nothing: a top-level category</option>
              {parents
                .filter((parent) => parent.status === 'active')
                .map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
            </NativeSelect>
          )}
        </FormField>
        <Button type="submit" className="h-11 self-start sm:h-9" disabled={busy}>
          <Plus aria-hidden="true" />
          Add category
        </Button>
      </form>

      {notice !== undefined && <FormMessage tone={notice.tone}>{notice.message}</FormMessage>}

      <ul
        aria-label={kind === 'expense' ? 'Spending categories' : 'Income categories'}
        className="divide-y"
      >
        {parents.flatMap((parent) => [
          <CategoryItem
            key={parent.id}
            category={parent}
            child={false}
            busy={busy}
            onRename={(next) =>
              run(() => renameCategory(parent.id, next), 'The category was renamed.')
            }
            onToggleArchived={() =>
              void run(
                () =>
                  parent.status === 'archived'
                    ? restoreCategory(parent.id)
                    : archiveCategory(parent.id),
                parent.status === 'archived'
                  ? `${parent.name} is active again.`
                  : `${parent.name} was archived. Past transactions keep it.`,
              )
            }
          />,
          ...ofKind
            .filter((category) => category.parentId === parent.id)
            .map((child) => (
              <CategoryItem
                key={child.id}
                category={child}
                child
                busy={busy}
                onRename={(next) =>
                  run(() => renameCategory(child.id, next), 'The category was renamed.')
                }
                onToggleArchived={() =>
                  void run(
                    () =>
                      child.status === 'archived'
                        ? restoreCategory(child.id)
                        : archiveCategory(child.id),
                    child.status === 'archived'
                      ? `${child.name} is active again.`
                      : `${child.name} was archived. Past transactions keep it.`,
                  )
                }
              />
            )),
        ])}
      </ul>
    </div>
  );
}

/**
 * Add, rename, archive, and restore categories. Archiving never touches past transactions or
 * budgets; an archived category just stops being offered for new ones.
 */
export function CategoryManagerSheet({
  open,
  onClose,
  ...props
}: CategoryManagerSheetProps): ReactNode {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b px-5 pt-5 pr-14 pb-4">
          <SheetTitle className="text-lg">Categories</SheetTitle>
          <SheetDescription>
            Group spending and income your way. Archived categories stay on past transactions.
          </SheetDescription>
        </SheetHeader>
        <div className="px-5 py-5">{open && <Manager {...props} />}</div>
      </SheetContent>
    </Sheet>
  );
}
