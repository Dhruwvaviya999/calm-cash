import { describe, expect, it } from 'vitest';

import type { CategoryRecord } from './categories.repository';
import { orderCategoryTree } from './categories.service';

const at = new Date('2026-01-01T00:00:00.000Z');

function category(
  id: string,
  name: string,
  kind: CategoryRecord['kind'],
  parentId: string | null = null,
): CategoryRecord {
  return {
    id,
    userId: 'u',
    name,
    kind,
    parentId,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

describe('orderCategoryTree', () => {
  it('lists expenses before income, parents before children, and "Other" last', () => {
    const ordered = orderCategoryTree([
      category('1', 'Salary', 'income'),
      category('2', 'Other', 'expense'),
      category('3', 'Fuel', 'expense', '5'),
      category('4', 'Groceries', 'expense'),
      category('5', 'Transport', 'expense'),
      category('6', 'Bus', 'expense', '5'),
      category('7', 'Other', 'income'),
      category('8', 'Freelance', 'income'),
    ]);
    expect(ordered.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'expense:Groceries',
      'expense:Transport',
      'expense:Bus',
      'expense:Fuel',
      'expense:Other',
      'income:Freelance',
      'income:Salary',
      'income:Other',
    ]);
  });
});
