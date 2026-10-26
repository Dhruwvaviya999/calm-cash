import type { CategoryKind } from '@calmcash/shared';

import { Prisma, type Category, type PrismaClient } from '../../generated/prisma/client';
import type { DefaultCategory } from './default-categories';

// Database access for categories. Every query is scoped by the owner's user ID.

export type CategoryRecord = Category;

export interface NewCategory {
  userId: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  createdAt: Date;
}

/** Thrown when the user already has a category with this name and kind. */
export class CategoryNameTakenError extends Error {
  override readonly name = 'CategoryNameTakenError';
}

export interface CategoriesRepository {
  /**
   * Creates the default categories for a user who has none yet. Idempotent and safe to run
   * concurrently: existing names are skipped, so nothing is ever duplicated.
   */
  ensureDefaults: (
    userId: string,
    defaults: readonly DefaultCategory[],
    createdAt: Date,
  ) => Promise<void>;
  list: (userId: string) => Promise<CategoryRecord[]>;
  findOwned: (userId: string, categoryId: string) => Promise<CategoryRecord | null>;
  /** A category of this kind whose name matches ignoring case, if any. */
  findByName: (userId: string, kind: CategoryKind, name: string) => Promise<CategoryRecord | null>;
  create: (category: NewCategory) => Promise<CategoryRecord>;
  rename: (userId: string, categoryId: string, name: string) => Promise<CategoryRecord | null>;
  /**
   * Archives (with its subcategories) or restores one category, leaving rows already in that state
   * untouched; null when not owned.
   */
  setArchived: (
    userId: string,
    categoryId: string,
    archivedAt: Date | null,
  ) => Promise<CategoryRecord | null>;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function createPrismaCategoriesRepository(prisma: PrismaClient): CategoriesRepository {
  return {
    ensureDefaults: async (userId, defaults, createdAt) => {
      if ((await prisma.category.count({ where: { userId } })) > 0) {
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.category.createMany({
          data: defaults.map(({ name, kind }) => ({ userId, name, kind, createdAt })),
          skipDuplicates: true,
        });
        const parents = await tx.category.findMany({
          where: { userId, parentId: null },
          select: { id: true, name: true, kind: true },
        });
        const children = defaults.flatMap(({ name, kind, children: names = [] }) => {
          const parent = parents.find((entry) => entry.name === name && entry.kind === kind);
          return parent === undefined
            ? []
            : names.map((child) => ({ userId, name: child, kind, parentId: parent.id, createdAt }));
        });
        await tx.category.createMany({ data: children, skipDuplicates: true });
      });
    },

    list: (userId) =>
      prisma.category.findMany({ where: { userId }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),

    findOwned: (userId, categoryId) =>
      prisma.category.findFirst({ where: { id: categoryId, userId } }),

    findByName: (userId, kind, name) =>
      prisma.category.findFirst({
        where: { userId, kind, name: { equals: name, mode: 'insensitive' } },
      }),

    create: async (category) => {
      try {
        return await prisma.category.create({ data: category });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new CategoryNameTakenError('Category name already in use.', { cause: error });
        }
        throw error;
      }
    },

    rename: async (userId, categoryId, name) => {
      try {
        const { count } = await prisma.category.updateMany({
          where: { id: categoryId, userId },
          data: { name },
        });
        return count === 0
          ? null
          : await prisma.category.findFirst({ where: { id: categoryId, userId } });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new CategoryNameTakenError('Category name already in use.', { cause: error });
        }
        throw error;
      }
    },

    setArchived: async (userId, categoryId, archivedAt) => {
      await prisma.category.updateMany({
        where: {
          userId,
          // Archiving a top-level category also archives its subcategories; restoring is per row.
          ...(archivedAt === null
            ? { id: categoryId }
            : { OR: [{ id: categoryId }, { parentId: categoryId }] }),
          archivedAt: archivedAt === null ? { not: null } : null,
        },
        data: { archivedAt },
      });
      return prisma.category.findFirst({ where: { id: categoryId, userId } });
    },
  };
}
