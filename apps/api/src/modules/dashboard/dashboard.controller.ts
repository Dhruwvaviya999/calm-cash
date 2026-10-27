import type {
  DashboardCategoriesDto,
  DashboardOverviewDto,
  DashboardQuery,
  DashboardTrendsDto,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { DashboardService } from './dashboard.service';

export interface DashboardController {
  overview: Handler<{ query: DashboardQuery }, DashboardOverviewDto>;
  trends: Handler<{ query: DashboardQuery }, DashboardTrendsDto>;
  categories: Handler<{ query: DashboardQuery }, DashboardCategoriesDto>;
}

/** Thin HTTP adapter: the caller comes from the session, the period and currency from the query. */
export function createDashboardController(
  service: DashboardService,
  getCaller: (req: object) => Caller,
): DashboardController {
  return {
    overview: async ({ query }, req, res) => {
      sendSuccess(res, await service.overview(getCaller(req), query));
    },
    trends: async ({ query }, req, res) => {
      sendSuccess(res, await service.trends(getCaller(req), query));
    },
    categories: async ({ query }, req, res) => {
      sendSuccess(res, await service.categories(getCaller(req), query));
    },
  };
}
