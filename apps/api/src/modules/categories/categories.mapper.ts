import type { CategoryDto } from '@calmcash/shared';

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
