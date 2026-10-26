import type {
  CategoryDto,
  CategoryListDto,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@calmcash/shared';
import type { Request } from 'express';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler, Ok } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { CategoriesService } from './categories.service';

interface CategoryParams {
  params: { categoryId: string };
}

export interface CategoriesController {
  list: (req: Request, res: Ok<CategoryListDto>) => Promise<void>;
  create: Handler<{ body: CreateCategoryInput }, CategoryDto>;
  rename: Handler<CategoryParams & { body: UpdateCategoryInput }, CategoryDto>;
  archive: Handler<CategoryParams, CategoryDto>;
  restore: Handler<CategoryParams, CategoryDto>;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createCategoriesController(
  service: CategoriesService,
  getCaller: (req: object) => Caller,
): CategoriesController {
  return {
    list: async (req, res) => {
      sendSuccess(res, await service.list(getCaller(req)));
    },
    create: async ({ body }, req, res) => {
      sendSuccess(res, await service.create(getCaller(req), body), 201);
    },
    rename: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.rename(getCaller(req), params.categoryId, body));
    },
    archive: async ({ params }, req, res) => {
      sendSuccess(res, await service.archive(getCaller(req), params.categoryId));
    },
    restore: async ({ params }, req, res) => {
      sendSuccess(res, await service.restore(getCaller(req), params.categoryId));
    },
  };
}
