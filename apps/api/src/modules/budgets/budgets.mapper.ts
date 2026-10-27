import { currencyCodeSchema, serializeMinorUnits, type BudgetDto } from '@calmcash/shared';

import { toIsoDate } from '../../lib/calendar-dates';
import type { BudgetRecord } from './budgets.repository';

// Database rows → public DTOs, field by field: `null` columns become absent properties, money
// becomes canonical strings, dates become `YYYY-MM-DD`.

export function toBudgetDto(budget: BudgetRecord): BudgetDto {
  return {
    id: budget.id,
    userId: budget.userId,
    name: budget.name,
    ...(budget.description === null ? {} : { description: budget.description }),
    ...(budget.categoryId === null ? {} : { categoryId: budget.categoryId }),
    limitMinor: serializeMinorUnits(budget.limitMinor),
    // The database accepts any well-formed code; the API only ever writes supported ones.
    currency: currencyCodeSchema.parse(budget.currency),
    period: budget.period,
    startDate: toIsoDate(budget.startDate),
    ...(budget.endDate === null ? {} : { endDate: toIsoDate(budget.endDate) }),
    alertThresholdsBp: [...budget.alertThresholdsBp],
    status: budget.archivedAt === null ? 'active' : 'archived',
    ...(budget.archivedAt === null ? {} : { archivedAt: budget.archivedAt.toISOString() }),
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}
