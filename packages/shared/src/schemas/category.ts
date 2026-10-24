import { z } from 'zod';

import { CATEGORY_KINDS, TEXT_LIMITS } from '../constants/domain';
import type { CategoryDto } from '../types/category';
import { entityIdSchema, isoDateTimeSchema } from './common';

export const categoryKindSchema = z.enum(CATEGORY_KINDS);

export const categoryDtoSchema = z.object({
  id: entityIdSchema,
  userId: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.categoryName),
  kind: categoryKindSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}) satisfies z.ZodType<CategoryDto>;
