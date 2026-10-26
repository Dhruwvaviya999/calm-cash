import { z } from 'zod';

import { CATEGORY_KINDS, TEXT_LIMITS } from '../constants/domain';
import { CATEGORY_STATUSES } from '../constants/transactions';
import type {
  CategoryDto,
  CategoryListDto,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../types/category';
import { entityIdSchema, isoDateTimeSchema } from './common';

export const categoryKindSchema = z.enum(CATEGORY_KINDS, { error: 'Choose income or expense.' });
export const categoryStatusSchema = z.enum(CATEGORY_STATUSES);

const NO_CONTROL_CHARACTERS = /^\P{Cc}*$/u;

export const categoryNameSchema = z
  .string({ error: 'Enter a name for this category.' })
  .trim()
  .min(1, { error: 'Enter a name for this category.' })
  .max(TEXT_LIMITS.categoryName, { error: `Use at most ${TEXT_LIMITS.categoryName} characters.` })
  .regex(NO_CONTROL_CHARACTERS, { error: 'Remove unsupported characters.' });

// --- Requests ------------------------------------------------------------------------------------

export const createCategoryInputSchema = z.strictObject({
  name: categoryNameSchema,
  kind: categoryKindSchema,
  parentId: entityIdSchema.exactOptional(),
}) satisfies z.ZodType<CreateCategoryInput>;

export const updateCategoryInputSchema = z.strictObject({
  name: categoryNameSchema,
}) satisfies z.ZodType<UpdateCategoryInput>;

// --- Responses -----------------------------------------------------------------------------------

export const categoryDtoSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(TEXT_LIMITS.categoryName),
    kind: categoryKindSchema,
    parentId: entityIdSchema.exactOptional(),
    status: categoryStatusSchema,
    archivedAt: isoDateTimeSchema.exactOptional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine((category) => (category.status === 'archived') === (category.archivedAt !== undefined), {
    message: 'Archived categories, and only those, have an archive time.',
    path: ['archivedAt'],
  }) satisfies z.ZodType<CategoryDto>;

export const categoryListDtoSchema = z.object({
  categories: z.array(categoryDtoSchema),
}) satisfies z.ZodType<CategoryListDto>;
