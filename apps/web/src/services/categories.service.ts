import {
  categoryDtoSchema,
  categoryListDtoSchema,
  type CategoryDto,
  type CategoryListDto,
  type CreateCategoryInput,
  type EntityId,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per categories endpoint; every response is validated against the shared schema.

function categoryPath(categoryId: EntityId): `/${string}` {
  return `/categories/${encodeURIComponent(categoryId)}`;
}

/** All of the user's categories; the API creates the default set on first use. */
export function listCategories(signal?: AbortSignal): Promise<CategoryListDto> {
  return api.request('/categories', { schema: categoryListDtoSchema, signal });
}

export function createCategory(input: CreateCategoryInput): Promise<CategoryDto> {
  return api.request('/categories', { schema: categoryDtoSchema, method: 'POST', body: input });
}

export function renameCategory(categoryId: EntityId, name: string): Promise<CategoryDto> {
  return api.request(categoryPath(categoryId), {
    schema: categoryDtoSchema,
    method: 'PATCH',
    body: { name },
  });
}

export function archiveCategory(categoryId: EntityId): Promise<CategoryDto> {
  return api.request(`${categoryPath(categoryId)}/archive`, {
    schema: categoryDtoSchema,
    method: 'POST',
  });
}

export function restoreCategory(categoryId: EntityId): Promise<CategoryDto> {
  return api.request(`${categoryPath(categoryId)}/restore`, {
    schema: categoryDtoSchema,
    method: 'POST',
  });
}
