import type { CategoryDto, CategoryKind } from '@calmcash/shared';
import type { ComponentProps, ReactNode } from 'react';

import { NativeSelect } from '@/components/ui/native-select';

export interface CategorySelectProps extends Omit<ComponentProps<'select'>, 'children'> {
  categories: readonly CategoryDto[];
  /** Only categories of this kind; all kinds when omitted (e.g. in filters). */
  kind?: CategoryKind;
  /** First option's label; its value is the empty string. */
  placeholder: string;
  /** An archived category that must stay selectable because the transaction already uses it. */
  keepId?: string | undefined;
}

const KIND_LABELS: Readonly<Record<CategoryKind, string>> = {
  expense: 'Spending',
  income: 'Income',
};

/**
 * A native select with one group per top-level category: the category itself, then its
 * subcategories. Archived categories are left out unless the transaction already uses one.
 */
export function CategorySelect({
  categories,
  kind,
  placeholder,
  keepId,
  ...props
}: CategorySelectProps): ReactNode {
  const visible = categories.filter(
    (category) =>
      (kind === undefined || category.kind === kind) &&
      (category.status === 'active' || category.id === keepId),
  );
  const parents = visible.filter((category) => category.parentId === undefined);
  const kinds: readonly CategoryKind[] = kind === undefined ? ['expense', 'income'] : [kind];

  return (
    <NativeSelect {...props}>
      <option value="">{placeholder}</option>
      {kinds.map((groupKind) =>
        parents
          .filter((parent) => parent.kind === groupKind)
          .map((parent) => {
            const children = visible.filter((category) => category.parentId === parent.id);
            const label =
              kind === undefined ? `${parent.name} (${KIND_LABELS[groupKind]})` : parent.name;
            return children.length === 0 ? (
              <option key={parent.id} value={parent.id}>
                {label}
              </option>
            ) : (
              <optgroup key={parent.id} label={label}>
                <option value={parent.id}>{parent.name} (general)</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </optgroup>
            );
          }),
      )}
    </NativeSelect>
  );
}
