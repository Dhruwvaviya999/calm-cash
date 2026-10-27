import { z } from 'zod';

import {
  DASHBOARD_PERIODS,
  DEFAULT_DASHBOARD_PERIOD,
  RATIO_UNAVAILABLE_REASONS,
  TREND_GRANULARITIES,
} from '../constants/dashboard';
import { TEXT_LIMITS } from '../constants/domain';
import type {
  CashFlowTotalsDto,
  CategorySpendEntryDto,
  DashboardCategoriesDto,
  DashboardOverviewDto,
  DashboardPeriodDto,
  DashboardQuery,
  DashboardTrendsDto,
  MetricChangeDto,
  PeriodComparisonDto,
  RatioDto,
  TrendBucketDto,
} from '../types/dashboard';
import { accountSummaryDtoSchema } from './account';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  minorUnitsSchema,
  timeZoneSchema,
} from './common';

export const dashboardPeriodSchema = z.enum(DASHBOARD_PERIODS, { error: 'Choose a period.' });
export const trendGranularitySchema = z.enum(TREND_GRANULARITIES);

/**
 * A ratio in basis points as a canonical integer string. Not money, so not bound to the BIGINT
 * range: a tiny income against a large spend gives a very large (negative) rate.
 */
export const basisPointsSchema = z
  .string()
  .max(40)
  .regex(/^(?:0|-?[1-9]\d*)$/, {
    error: 'Must be a whole number of basis points.',
  });

const integerStringSchema = basisPointsSchema;

// --- Query -----------------------------------------------------------------------------------------

export const dashboardQuerySchema = z
  .strictObject({
    period: dashboardPeriodSchema.default(DEFAULT_DASHBOARD_PERIOD),
    from: isoDateSchema.exactOptional(),
    to: isoDateSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
  })
  .superRefine((query, context) => {
    if (query.period === 'custom') {
      for (const field of ['from', 'to'] as const) {
        if (query[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'A custom period needs a start and an end date.',
          });
        }
      }
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'The end date must be on or after the start date.',
        });
      }
    } else if (query.from !== undefined || query.to !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['period'],
        message: 'Dates can only be given with the custom period.',
      });
    }
  }) satisfies z.ZodType<DashboardQuery>;

// --- Responses ---------------------------------------------------------------------------------------

export const ratioDtoSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), basisPoints: integerStringSchema }),
  z.object({ status: z.literal('unavailable'), reason: z.enum(RATIO_UNAVAILABLE_REASONS) }),
]) satisfies z.ZodType<RatioDto>;

export const dashboardPeriodDtoSchema = z.object({
  period: dashboardPeriodSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  timeZone: timeZoneSchema,
}) satisfies z.ZodType<DashboardPeriodDto>;

export const cashFlowTotalsDtoSchema = z.object({
  incomeMinor: minorUnitsSchema,
  expenseMinor: minorUnitsSchema,
  netMinor: minorUnitsSchema,
  incomeCount: z.number().int().nonnegative(),
  expenseCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<CashFlowTotalsDto>;

export const metricChangeDtoSchema = z.object({
  previousMinor: minorUnitsSchema,
  changeMinor: minorUnitsSchema,
  changePercent: ratioDtoSchema,
}) satisfies z.ZodType<MetricChangeDto>;

export const periodComparisonDtoSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    from: isoDateSchema,
    to: isoDateSchema,
    income: metricChangeDtoSchema,
    expense: metricChangeDtoSchema,
    net: z.object({ previousMinor: minorUnitsSchema, changeMinor: minorUnitsSchema }),
  }),
  z.object({
    status: z.literal('unavailable'),
    from: isoDateSchema,
    to: isoDateSchema,
    reason: z.literal('no_previous_activity'),
  }),
]) satisfies z.ZodType<PeriodComparisonDto>;

export const dashboardOverviewDtoSchema = z.object({
  period: dashboardPeriodDtoSchema,
  currency: currencyCodeSchema,
  currencies: z.array(currencyCodeSchema),
  position: accountSummaryDtoSchema,
  accounts: z.object({
    active: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  }),
  hasTransactions: z.boolean(),
  cashFlow: cashFlowTotalsDtoSchema,
  savingsRate: ratioDtoSchema,
  comparison: periodComparisonDtoSchema,
}) satisfies z.ZodType<DashboardOverviewDto>;

export const trendBucketDtoSchema = z.object({
  start: isoDateSchema,
  end: isoDateSchema,
  partial: z.boolean(),
  incomeMinor: minorUnitsSchema,
  expenseMinor: minorUnitsSchema,
  netMinor: minorUnitsSchema,
}) satisfies z.ZodType<TrendBucketDto>;

export const dashboardTrendsDtoSchema = z.object({
  period: dashboardPeriodDtoSchema,
  currency: currencyCodeSchema,
  granularity: trendGranularitySchema,
  buckets: z.array(trendBucketDtoSchema),
}) satisfies z.ZodType<DashboardTrendsDto>;

const spendBaseShape = {
  amountMinor: minorUnitsSchema,
  transactionCount: z.number().int().nonnegative(),
  shareBasisPoints: integerStringSchema,
};

export const categorySpendEntryDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    ...spendBaseShape,
    kind: z.literal('category'),
    categoryId: entityIdSchema,
    name: z.string().min(1).max(TEXT_LIMITS.categoryName),
    archived: z.boolean(),
  }),
  z.object({ ...spendBaseShape, kind: z.literal('uncategorized') }),
  z.object({
    ...spendBaseShape,
    kind: z.literal('other'),
    categoryCount: z.number().int().positive(),
  }),
]) satisfies z.ZodType<CategorySpendEntryDto>;

export const dashboardCategoriesDtoSchema = z.object({
  period: dashboardPeriodDtoSchema,
  currency: currencyCodeSchema,
  totalExpenseMinor: minorUnitsSchema,
  expenseCount: z.number().int().nonnegative(),
  entries: z.array(categorySpendEntryDtoSchema),
}) satisfies z.ZodType<DashboardCategoriesDto>;
