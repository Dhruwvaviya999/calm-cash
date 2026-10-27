'use client';

import type { CategorySpendEntryDto, DashboardCategoriesDto } from '@calmcash/shared';
import { PiggyBank } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import {
  CHART_COLORS,
  ChartEmptyState,
  ChartTableDisclosure,
  ChartTooltipCard,
  ChartTooltipRow,
} from '@/components/charts/chart-parts';
import { formatBasisPoints, formatMoney } from '@/lib/format';

const ROW_HEIGHT = 40;
const LABEL_WIDTH = 116;
const MAX_LABEL_CHARACTERS = 15;

interface Row {
  index: number;
  label: string;
  /** Bar length only; the value label and tooltip use the exact strings. */
  amount: number;
}

export function entryLabel(entry: CategorySpendEntryDto): string {
  switch (entry.kind) {
    case 'category':
      return entry.archived ? `${entry.name} (archived)` : entry.name;
    case 'uncategorized':
      return 'Uncategorised';
    case 'other':
      return `Other (${String(entry.categoryCount)} categories)`;
  }
}

/** The transactions behind an entry: one category (with its subcategories) or all spending. */
export function entryHref(
  entry: CategorySpendEntryDto,
  period: { from: string; to: string },
): `/transactions?${string}` {
  const range = `from=${period.from}&to=${period.to}`;
  return entry.kind === 'category'
    ? `/transactions?type=expense&categoryId=${entry.categoryId}&${range}`
    : `/transactions?type=expense&${range}`;
}

function shorten(label: string): string {
  return label.length > MAX_LABEL_CHARACTERS
    ? `${label.slice(0, MAX_LABEL_CHARACTERS - 1)}…`
    : label;
}

/** Category name beside its bar, shortened to fit; the full name is in the tooltip and table. */
function CategoryTick({
  x,
  y,
  payload,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
}): ReactNode {
  const label = typeof payload?.value === 'string' ? payload.value : '';
  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={4}
      textAnchor="end"
      fill={CHART_COLORS.axis}
      fontSize={12}
    >
      <title>{label}</title>
      {shorten(label)}
    </text>
  );
}

/**
 * Where the money went in the period: spending per top-level category, largest first, in one
 * colour (the bar length carries the comparison; names are labels, not colours). Selecting a bar
 * opens those expenses. Uncategorised spending and "Other" are only shown when they exist.
 */
export function SpendingChart({ categories }: { categories: DashboardCategoriesDto }): ReactNode {
  const router = useRouter();
  const { entries, currency, period } = categories;

  if (entries.length === 0) {
    return (
      <ChartEmptyState
        icon={PiggyBank}
        title="No spending to show"
        description={`No expenses in ${currency} were recorded in this period.`}
      />
    );
  }

  const rows: Row[] = entries.map((entry, index) => ({
    index,
    label: entryLabel(entry),
    amount: Number(entry.amountMinor),
  }));

  const renderTooltip = ({ active, activeIndex }: TooltipContentProps): ReactNode => {
    const entry = active ? entries[Number(activeIndex)] : undefined;
    if (entry === undefined) {
      return null;
    }
    return (
      <ChartTooltipCard title={entryLabel(entry)}>
        <ChartTooltipRow
          label="spent"
          value={formatMoney(entry.amountMinor, currency)}
          color={CHART_COLORS.expense}
        />
        <ChartTooltipRow label="of spending" value={formatBasisPoints(entry.shareBasisPoints)} />
        <ChartTooltipRow
          label={entry.transactionCount === 1 ? 'expense' : 'expenses'}
          value={entry.transactionCount.toString()}
        />
      </ChartTooltipCard>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Spending by category in ${currency}. Use “Show as table” for every value.`}
      >
        <ResponsiveContainer width="100%" height={rows.length * ROW_HEIGHT + 8}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 88, bottom: 4, left: 0 }}
            barCategoryGap={8}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="label"
              width={LABEL_WIDTH}
              tickLine={false}
              axisLine={false}
              tick={CategoryTick}
            />
            <Tooltip content={renderTooltip} cursor={{ fill: CHART_COLORS.cursor, opacity: 0.6 }} />
            <Bar
              dataKey="amount"
              fill={CHART_COLORS.expense}
              radius={[0, 4, 4, 0]}
              maxBarSize={24}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(_bar, index) => {
                const entry = entries[index];
                if (entry !== undefined) {
                  router.push(entryHref(entry, period));
                }
              }}
            >
              <LabelList
                dataKey="index"
                position="right"
                fill="var(--color-foreground)"
                fontSize={12}
                formatter={(value: unknown) => {
                  const entry = entries[Number(value)];
                  return entry === undefined ? '' : formatMoney(entry.amountMinor, currency);
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTableDisclosure caption={`Spending by category, ${currency}`}>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Category
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Spent
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Share
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Expenses
            </th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {entries.map((entry) => (
            <tr key={entry.kind === 'category' ? entry.categoryId : entry.kind}>
              <th scope="row" className="py-1.5 pr-3 font-normal">
                <Link
                  href={entryHref(entry, period)}
                  className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {entryLabel(entry)}
                </Link>
              </th>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatMoney(entry.amountMinor, currency)}
              </td>
              <td className="py-1.5 pr-3 text-right">
                {formatBasisPoints(entry.shareBasisPoints)}
              </td>
              <td className="py-1.5 text-right">{entry.transactionCount}</td>
            </tr>
          ))}
        </tbody>
      </ChartTableDisclosure>
    </div>
  );
}
