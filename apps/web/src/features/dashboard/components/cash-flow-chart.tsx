'use client';

import type { DashboardTrendsDto, TrendBucketDto, TrendGranularity } from '@calmcash/shared';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import {
  AXIS_TICK,
  CHART_COLORS,
  ChartEmptyState,
  ChartLegendItem,
  ChartTableDisclosure,
  ChartTooltipCard,
  ChartTooltipRow,
} from '@/components/charts/chart-parts';
import { formatCompactMoney, formatDate, formatMoney } from '@/lib/format';

export const CASH_FLOW_CHART_HEIGHT = 280;

interface Point {
  index: number;
  label: string;
  /** Bar length only; every number a person reads comes from the exact strings. */
  income: number;
  expense: number;
}

/** Short axis label of a bucket. */
function tickLabel(bucket: TrendBucketDto, granularity: TrendGranularity): string {
  switch (granularity) {
    case 'day':
    case 'week':
      return formatDate(bucket.start, 'dayMonth');
    case 'month':
      return formatDate(bucket.start, 'monthShortYear');
    case 'year':
      return bucket.start.slice(0, 4);
  }
}

/** Full description of the days a bucket covers, e.g. "26 Oct – 27 Oct 2026". */
export function describeBucket(bucket: TrendBucketDto, granularity: TrendGranularity): string {
  if (bucket.start === bucket.end) {
    return formatDate(bucket.start, 'fullDate');
  }
  if (granularity === 'month' && !bucket.partial) {
    return formatDate(bucket.start, 'monthYear');
  }
  if (granularity === 'year' && !bucket.partial) {
    return bucket.start.slice(0, 4);
  }
  return `${formatDate(bucket.start, 'dayMonth')} – ${formatDate(bucket.end, 'dayMonthYear')}`;
}

function hasActivity(buckets: readonly TrendBucketDto[]): boolean {
  return buckets.some((bucket) => bucket.incomeMinor !== '0' || bucket.expenseMinor !== '0');
}

/**
 * Money in and money out per day, week, or month of the period, side by side on one axis.
 * Hovering (or moving through the chart with the arrow keys) shows both figures and the net for a
 * bucket; selecting a bar opens the matching transactions. A table view lists every value.
 */
export function CashFlowChart({ trends }: { trends: DashboardTrendsDto }): ReactNode {
  const router = useRouter();
  const { buckets, currency, granularity } = trends;

  if (!hasActivity(buckets)) {
    return (
      <ChartEmptyState
        title="No income or spending to chart"
        description={`Nothing in ${currency} was recorded as income or spending in this period. Transfers and balance corrections are not part of cash flow.`}
      />
    );
  }

  const data: Point[] = buckets.map((bucket, index) => ({
    index,
    label: tickLabel(bucket, granularity),
    income: Number(bucket.incomeMinor),
    expense: Number(bucket.expenseMinor),
  }));

  const open = (index: number, type: 'income' | 'expense'): void => {
    const bucket = buckets[index];
    if (bucket !== undefined) {
      router.push(`/transactions?type=${type}&from=${bucket.start}&to=${bucket.end}`);
    }
  };

  const renderTooltip = ({ active, activeIndex }: TooltipContentProps): ReactNode => {
    const bucket = active ? buckets[Number(activeIndex)] : undefined;
    if (bucket === undefined) {
      return null;
    }
    return (
      <ChartTooltipCard
        title={describeBucket(bucket, granularity)}
        note={bucket.partial ? 'Only part of this period is included' : undefined}
      >
        <ChartTooltipRow
          label="Money in"
          value={formatMoney(bucket.incomeMinor, currency)}
          color={CHART_COLORS.income}
        />
        <ChartTooltipRow
          label="Money out"
          value={formatMoney(bucket.expenseMinor, currency)}
          color={CHART_COLORS.expense}
        />
        <ChartTooltipRow label="Net" value={formatMoney(bucket.netMinor, currency)} />
      </ChartTooltipCard>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Chart legend" className="flex flex-wrap gap-x-4 gap-y-1">
        <ChartLegendItem label="Money in" color={CHART_COLORS.income} />
        <ChartLegendItem label="Money out" color={CHART_COLORS.expense} />
      </ul>
      <div
        role="img"
        aria-label={`Money in and money out per ${granularity} in ${currency}. Use “Show as table” for every value.`}
        className="-ml-2"
      >
        <ResponsiveContainer width="100%" height={CASH_FLOW_CHART_HEIGHT}>
          <BarChart
            data={data}
            barGap={2}
            barCategoryGap="20%"
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
              tick={AXIS_TICK}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              allowDecimals={false}
              tickFormatter={(value: number) =>
                formatCompactMoney(BigInt(Math.round(value)), currency)
              }
            />
            <Tooltip content={renderTooltip} cursor={{ fill: CHART_COLORS.cursor, opacity: 0.6 }} />
            <Bar
              dataKey="income"
              name="Money in"
              fill={CHART_COLORS.income}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(_bar, index) => {
                open(index, 'income');
              }}
            />
            <Bar
              dataKey="expense"
              name="Money out"
              fill={CHART_COLORS.expense}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(_bar, index) => {
                open(index, 'expense');
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTableDisclosure caption={`Money in and out per ${granularity}, ${currency}`}>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Period
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Money in
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Money out
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Net
            </th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {buckets.map((bucket) => (
            <tr key={bucket.start}>
              <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap">
                {describeBucket(bucket, granularity)}
                {bucket.partial && <span className="text-muted-foreground"> (part)</span>}
              </th>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatMoney(bucket.incomeMinor, currency)}
              </td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatMoney(bucket.expenseMinor, currency)}
              </td>
              <td className="py-1.5 text-right whitespace-nowrap">
                {formatMoney(bucket.netMinor, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </ChartTableDisclosure>
    </div>
  );
}
