import {
  dashboardCategoriesDtoSchema,
  dashboardOverviewDtoSchema,
  dashboardTrendsDtoSchema,
  type DashboardCategoriesDto,
  type DashboardOverviewDto,
  type DashboardTrendsDto,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per dashboard endpoint; every response is validated against the shared schema.
// `query` is the query string built from the validated selection, without the leading `?`.

function withQuery(path: `/${string}`, query: string): `/${string}` {
  return query === '' ? path : `${path}?${query}`;
}

export function getDashboardOverview(
  query: string,
  signal?: AbortSignal,
): Promise<DashboardOverviewDto> {
  return api.request(withQuery('/dashboard/overview', query), {
    schema: dashboardOverviewDtoSchema,
    signal,
  });
}

export function getDashboardTrends(
  query: string,
  signal?: AbortSignal,
): Promise<DashboardTrendsDto> {
  return api.request(withQuery('/dashboard/trends', query), {
    schema: dashboardTrendsDtoSchema,
    signal,
  });
}

export function getDashboardCategories(
  query: string,
  signal?: AbortSignal,
): Promise<DashboardCategoriesDto> {
  return api.request(withQuery('/dashboard/categories', query), {
    schema: dashboardCategoriesDtoSchema,
    signal,
  });
}
