import type { CategoryDto, PlanningCategoryRefDto } from '@calmcash/shared';

import type { CategoryRecord } from './categories.repository';

/** Database category → public DTO, field by field. */
export function toCategoryDto(category: CategoryRecord): CategoryDto {
  return {
    id: category.id,
    userId: category.userId,
    name: category.name,
    kind: category.kind,
    ...(category.parentId === null ? {} : { parentId: category.parentId }),
    status: category.archivedAt === null ? 'active' : 'archived',
    ...(category.archivedAt === null ? {} : { archivedAt: category.archivedAt.toISOString() }),
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

/** A category with its parent's name, as planning views (budgets, schedules) show it. */
export function toPlanningCategoryRef(
  category: CategoryRecord & { parent: { name: string } | null },
): PlanningCategoryRefDto {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    ...(category.parentId === null ? {} : { parentId: category.parentId }),
    ...(category.parent === null ? {} : { parentName: category.parent.name }),
    status: category.archivedAt === null ? 'active' : 'archived',
  };
}
