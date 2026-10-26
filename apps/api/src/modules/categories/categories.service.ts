import type {
  CategoryDto,
  CategoryListDto,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import {
  CategoryNameTakenError,
  type CategoriesRepository,
  type CategoryRecord,
} from './categories.repository';
import { toCategoryDto } from './categories.mapper';
import { DEFAULT_CATEGORIES } from './default-categories';

export interface CategoriesService {
  list: (caller: Caller) => Promise<CategoryListDto>;
  create: (caller: Caller, input: CreateCategoryInput) => Promise<CategoryDto>;
  rename: (caller: Caller, categoryId: string, input: UpdateCategoryInput) => Promise<CategoryDto>;
  archive: (caller: Caller, categoryId: string) => Promise<CategoryDto>;
  restore: (caller: Caller, categoryId: string) => Promise<CategoryDto>;
}

export interface CategoriesServiceDependencies {
  repository: CategoriesRepository;
  now: () => Date;
}

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That category does not exist or is not yours.');

function nameTaken(kind: string, name: string): AppError {
  return new AppError(409, 'CONFLICT', `You already have an ${kind} category called “${name}”.`, {
    details: [{ path: 'body.name', message: 'Choose a different name.' }],
  });
}

function invalidParent(message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
    details: [{ path: 'body.parentId', message }],
  });
}

/** "Other" goes last; everything else alphabetically. */
function compareNames(a: CategoryRecord, b: CategoryRecord): number {
  if ((a.name === 'Other') !== (b.name === 'Other')) {
    return a.name === 'Other' ? 1 : -1;
  }
  return a.name.localeCompare(b.name, 'en');
}

/** Expense categories, then income ones; each top-level category directly before its children. */
export function orderCategoryTree(records: readonly CategoryRecord[]): CategoryRecord[] {
  const ordered: CategoryRecord[] = [];
  for (const kind of ['expense', 'income'] as const) {
    const ofKind = records.filter((record) => record.kind === kind);
    const parents = ofKind.filter((record) => record.parentId === null).sort(compareNames);
    for (const parent of parents) {
      ordered.push(
        parent,
        ...ofKind.filter((record) => record.parentId === parent.id).sort(compareNames),
      );
    }
  }
  return ordered;
}

export function createCategoriesService({
  repository,
  now,
}: CategoriesServiceDependencies): CategoriesService {
  const ensureDefaults = (caller: Caller): Promise<void> =>
    repository.ensureDefaults(caller.userId, DEFAULT_CATEGORIES, now());

  const owned = async (caller: Caller, categoryId: string): Promise<CategoryRecord> => {
    const category = await repository.findOwned(caller.userId, categoryId);
    if (category === null) {
      throw notFound();
    }
    return category;
  };

  return {
    list: async (caller) => {
      await ensureDefaults(caller);
      const records = await repository.list(caller.userId);
      return { categories: orderCategoryTree(records).map(toCategoryDto) };
    },

    create: async (caller, input) => {
      await ensureDefaults(caller);
      let parentId: string | null = null;
      if (input.parentId !== undefined) {
        const parent = await repository.findOwned(caller.userId, input.parentId);
        if (parent === null) {
          throw invalidParent('Choose one of your categories.');
        }
        if (parent.parentId !== null) {
          throw invalidParent('Subcategories cannot have subcategories of their own.');
        }
        if (parent.kind !== input.kind) {
          throw invalidParent(`Choose an ${input.kind} category.`);
        }
        if (parent.archivedAt !== null) {
          throw invalidParent(`Restore “${parent.name}” before adding to it.`);
        }
        parentId = parent.id;
      }
      if ((await repository.findByName(caller.userId, input.kind, input.name)) !== null) {
        throw nameTaken(input.kind, input.name);
      }
      try {
        return toCategoryDto(
          await repository.create({
            userId: caller.userId,
            name: input.name,
            kind: input.kind,
            parentId,
            createdAt: now(),
          }),
        );
      } catch (error: unknown) {
        if (error instanceof CategoryNameTakenError) {
          throw nameTaken(input.kind, input.name);
        }
        throw error;
      }
    },

    rename: async (caller, categoryId, input) => {
      const current = await owned(caller, categoryId);
      if (current.archivedAt !== null) {
        throw new AppError(409, 'CONFLICT', 'Restore this category before renaming it.');
      }
      if (current.name === input.name) {
        return toCategoryDto(current);
      }
      const clash = await repository.findByName(caller.userId, current.kind, input.name);
      if (clash !== null && clash.id !== current.id) {
        throw nameTaken(current.kind, input.name);
      }
      try {
        const renamed = await repository.rename(caller.userId, categoryId, input.name);
        if (renamed === null) {
          throw notFound();
        }
        return toCategoryDto(renamed);
      } catch (error: unknown) {
        if (error instanceof CategoryNameTakenError) {
          throw nameTaken(current.kind, input.name);
        }
        throw error;
      }
    },

    archive: async (caller, categoryId) => {
      const archived = await repository.setArchived(caller.userId, categoryId, now());
      if (archived === null) {
        throw notFound();
      }
      return toCategoryDto(archived);
    },

    restore: async (caller, categoryId) => {
      const current = await owned(caller, categoryId);
      if (current.parentId !== null) {
        const parent = await owned(caller, current.parentId);
        if (parent.archivedAt !== null) {
          throw new AppError(409, 'CONFLICT', `Restore “${parent.name}” first.`);
        }
      }
      const restored = await repository.setArchived(caller.userId, categoryId, null);
      if (restored === null) {
        throw notFound();
      }
      return toCategoryDto(restored);
    },
  };
}
