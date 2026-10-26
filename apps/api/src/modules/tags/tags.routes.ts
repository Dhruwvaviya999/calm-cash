import type { TagListDto } from '@calmcash/shared';
import { Router, type Request } from 'express';

import { noStore, type AuthBoundary } from '../../lib/auth-boundary';
import type { Ok } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { TagsRepository } from './tags.repository';

export interface TagsModuleDependencies {
  repository: TagsRepository;
}

/** Enough for suggestions; a person with more tags still finds the rest by typing. */
export const MAX_LISTED_TAGS = 200;

export interface TagsService {
  list: (userId: string) => Promise<TagListDto>;
}

export function createTagsService(repository: TagsRepository): TagsService {
  return {
    list: async (userId) => ({ tags: await repository.listUsage(userId, MAX_LISTED_TAGS) }),
  };
}

/**
 * GET /   the tags used on the caller's active transactions, with how often (for suggestions and
 *         filters). Tags are added and removed through transactions, never on their own.
 */
export function createTagsRouter(dependencies: TagsModuleDependencies, auth: AuthBoundary): Router {
  const service = createTagsService(dependencies.repository);
  const router = Router();

  router.use(auth.requireSession, auth.requireCsrf, noStore);
  router.get('/', async (req: Request, res: Ok<TagListDto>) => {
    sendSuccess(res, await service.list(auth.getCaller(req).userId));
  });

  return router;
}
