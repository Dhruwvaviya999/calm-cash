import type { CategoryDto, EntityId, IsoDateTimeString, MinorUnitsString } from '@calmcash/shared';

import type { BudgetProgressProps } from '@/features/budgets';

/*
 * ⚠ PROTOTYPE-ONLY SAMPLE DATA — the Budgets design preview (until budgets are built).
 *
 * Every value here is invented. It is typed with the shared API contracts and the features' view
 * models, so the UI is built against real shapes, but it must:
 *   - only be rendered next to a <PreviewNotice> or a "Sample data" label;
 *   - never be imported by components/, hooks/, lib/, services/, or types/ (enforced by ESLint);
 *   - never be sent to the API or persisted.
 * The dashboard, accounts, and transactions use live API data and must never import this file
 * (enforced by ESLint). Figures here are stated, not calculated.
 */

const SAMPLE_USER_ID: EntityId = '0193a000-0000-7000-8000-000000000001';
const CREATED_AT: IsoDateTimeString = '2026-09-01T04:30:00.000Z';

function sampleId(sequence: number): EntityId {
  return `0193a000-0000-7000-8000-${sequence.toString().padStart(12, '0')}`;
}

const audit = { userId: SAMPLE_USER_ID, createdAt: CREATED_AT, updatedAt: CREATED_AT } as const;

// --- Categories -------------------------------------------------------------------------------

function category(sequence: number, name: string, kind: CategoryDto['kind']): CategoryDto {
  return { id: sampleId(100 + sequence), name, kind, status: 'active', ...audit };
}

export const sampleCategories = {
  groceries: category(1, 'Groceries', 'expense'),
  dining: category(2, 'Dining out', 'expense'),
  transport: category(3, 'Transport', 'expense'),
  bills: category(4, 'Bills & utilities', 'expense'),
  rent: category(5, 'Rent', 'expense'),
  shopping: category(6, 'Shopping', 'expense'),
  health: category(7, 'Health', 'expense'),
  entertainment: category(8, 'Entertainment', 'expense'),
  salary: category(9, 'Salary', 'income'),
  freelance: category(10, 'Freelance', 'income'),
  interest: category(11, 'Interest', 'income'),
} as const satisfies Record<string, CategoryDto>;

// --- Budgets ----------------------------------------------------------------------------------

function budget(
  sequence: number,
  budgetCategory: CategoryDto,
  limitMinor: MinorUnitsString,
  spentMinor: MinorUnitsString,
): BudgetProgressProps {
  return {
    budget: {
      id: sampleId(400 + sequence),
      name: budgetCategory.name,
      categoryId: budgetCategory.id,
      limitMinor,
      currency: 'INR',
      period: 'monthly',
      startDate: '2026-10-01',
      ...audit,
    },
    category: budgetCategory,
    spentMinor,
  };
}

/** Stated sample spending per budget (real figures will be calculated by the API). */
export const sampleBudgets: readonly BudgetProgressProps[] = [
  budget(1, sampleCategories.groceries, '1200000', '845000'),
  budget(2, sampleCategories.dining, '500000', '462000'),
  budget(3, sampleCategories.shopping, '600000', '689900'),
  budget(4, sampleCategories.transport, '800000', '410000'),
];
