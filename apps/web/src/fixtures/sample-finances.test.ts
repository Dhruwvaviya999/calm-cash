import { budgetDtoSchema, categoryDtoSchema, parseMinorUnits } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { sampleBudgets, sampleCategories } from './sample-finances';

describe('sample fixtures (Budgets preview only)', () => {
  it('conform to the shared API contracts', () => {
    for (const entry of Object.values(sampleCategories)) categoryDtoSchema.parse(entry);
    for (const entry of sampleBudgets) budgetDtoSchema.parse(entry.budget);
  });

  it('pair every budget with its category and state positive figures', () => {
    for (const entry of sampleBudgets) {
      expect(entry.budget.categoryId).toBe(entry.category?.id);
      expect(parseMinorUnits(entry.spentMinor)).toBeGreaterThanOrEqual(0n);
    }
  });
});
