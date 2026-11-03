'use client';

import {
  SPENDING_PATTERN_PERIODS,
  type CurrencyCode,
  type SpendingPatternPeriod,
  type SpendingPatternsDto,
} from '@calmcash/shared';
import { useCallback, useId, useState, type ReactNode } from 'react';
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
  ChartLegendItem,
  ChartSkeleton,
  ChartTableDisclosure,
  ChartTooltipCard,
  ChartTooltipRow,
} from '@/components/charts/chart-parts';
import { ErrorState } from '@/components/feedback/error-state';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { SectionHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatBasisPoints, formatCompactMoney, formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { getSpendingPatterns } from '@/services/intelligence.service';

import { chartNumber, monthLabel } from '../intelligence-presentation';
import {
  CalculatedAt,
  FigureKindLabel,
  MethodologyDisclosure,
  SufficiencyNote,
} from './intelligence-parts';

const PERIOD_LABELS: Readonly<Record<SpendingPatternPeriod, string>> = {
  'last-30-days': 'Last 30 days',
  'last-90-days': 'Last 90 days',
  'last-6-months': 'Last 6 months',
  'last-12-months': 'Last 12 months',
  'this-year': 'This year',
  'last-year': 'Last year',
  custom: 'Custom dates',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function isPeriod(value: string): value is SpendingPatternPeriod {
  return SPENDING_PATTERN_PERIODS.some((period) => period === value);
}

function MonthlyChart({ data }: { data: SpendingPatternsDto }): ReactNode {
  const points = data.monthly.map((month) => ({
    label: monthLabel(month.month),
    income: chartNumber(month.incomeMinor),
    expense: chartNumber(month.expenseMinor),
  }));
  const renderTooltip = ({ active, activeIndex }: TooltipContentProps): ReactNode => {
    const month = active ? data.monthly[Number(activeIndex)] : undefined;
    if (month === undefined) return null;
    return (
      <ChartTooltipCard
        title={formatDate(`${month.month}-01`, 'monthYear')}
        note={month.partial ? 'Only part of this month is included' : undefined}
      >
        <ChartTooltipRow
          label="Money in"
          value={formatMoney(month.incomeMinor, data.currency)}
          color={CHART_COLORS.income}
        />
        <ChartTooltipRow
          label="Money out"
          value={formatMoney(month.expenseMinor, data.currency)}
          color={CHART_COLORS.expense}
        />
        <ChartTooltipRow label="Net" value={formatMoney(month.netMinor, data.currency)} />
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
        aria-label={`Income and spending per month in ${data.currency}. Use “Show as table” for every value.`}
        className="-ml-2"
      >
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={points} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
              tick={AXIS_TICK}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              allowDecimals={false}
              tickFormatter={(value: number) =>
                formatCompactMoney(BigInt(Math.round(value)), data.currency)
              }
            />
            <Tooltip content={renderTooltip} cursor={{ fill: CHART_COLORS.cursor, opacity: 0.6 }} />
            <Bar
              dataKey="income"
              fill={CHART_COLORS.income}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="expense"
              fill={CHART_COLORS.expense}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTableDisclosure caption={`Income and spending per month, ${data.currency}`}>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Month
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
          {data.monthly.map((month) => (
            <tr key={month.month}>
              <th scope="row" className="py-1.5 pr-3 font-normal">
                {formatDate(`${month.month}-01`, 'monthYear')}
                {month.partial && <span className="text-muted-foreground"> (part)</span>}
              </th>
              <td className="py-1.5 pr-3 text-right">
                {formatMoney(month.incomeMinor, data.currency)}
              </td>
              <td className="py-1.5 pr-3 text-right">
                {formatMoney(month.expenseMinor, data.currency)}
              </td>
              <td className="py-1.5 text-right">{formatMoney(month.netMinor, data.currency)}</td>
            </tr>
          ))}
        </tbody>
      </ChartTableDisclosure>
    </div>
  );
}

export function SpendingPatternsSection({
  currency,
  timeZone,
}: {
  currency: CurrencyCode | undefined;
  timeZone: string;
}): ReactNode {
  const periodId = useId();
  const [period, setPeriod] = useState<SpendingPatternPeriod>('last-90-days');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const search = new URLSearchParams({
    period,
    ...(period === 'custom' && from !== '' && to !== '' ? { from, to } : {}),
    ...(currency === undefined ? {} : { currency }),
  }).toString();
  const ready = period !== 'custom' || (from !== '' && to !== '');
  const patterns = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<SpendingPatternsDto | undefined> =>
        ready ? getSpendingPatterns(search, signal) : Promise.resolve(undefined),
      [ready, search],
    ),
  );
  const data = patterns.state.status === 'success' ? patterns.state.data : undefined;

  return (
    <section aria-labelledby="patterns-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="patterns-heading"
        title="Spending trends"
        description="Actual figures for a period, compared with the same number of days just before. They show what changed, not why."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1 text-sm sm:w-48">
          <label htmlFor={periodId} className="text-muted-foreground">
            Period
          </label>
          <NativeSelect
            id={periodId}
            value={period}
            onChange={(event) => {
              if (isPeriod(event.target.value)) setPeriod(event.target.value);
            }}
          >
            {SPENDING_PATTERN_PERIODS.map((value) => (
              <option key={value} value={value}>
                {PERIOD_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {period === 'custom' && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">From</span>
              <Input
                type="date"
                className="h-11"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">To</span>
              <Input
                type="date"
                className="h-11"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                }}
              />
            </label>
          </>
        )}
      </div>
      {!ready && <p className="text-sm text-muted-foreground">Choose a start and an end date.</p>}
      {patterns.state.status === 'loading' && (
        <ChartSkeleton height={220} label="Loading spending trends" />
      )}
      {patterns.state.status === 'error' && (
        <ErrorState
          title="Spending trends could not be loaded"
          description={describeRequestError(patterns.state.error)}
          onRetry={patterns.reload}
        />
      )}
      {data !== undefined && (
        <Card className="flex flex-col gap-5 p-4 sm:p-5">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <FigureKindLabel kind="actual" />
            {formatDate(data.from, 'dayMonth')} – {formatDate(data.to, 'dayMonthYear')} ·{' '}
            {data.currency} · compared with {formatDate(data.comparedTo.from, 'dayMonth')} –{' '}
            {formatDate(data.comparedTo.to, 'dayMonthYear')}
          </p>
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              {
                label: 'Spending',
                amount: data.totals.expenseMinor,
                note: `${data.totals.expenseCount.toString()} expenses`,
              },
              {
                label: 'Income',
                amount: data.totals.incomeMinor,
                note: `${data.totals.incomeCount.toString()} entries`,
              },
              ...(data.distribution === undefined
                ? []
                : [
                    {
                      label: 'Typical expense (median)',
                      amount: data.distribution.medianMinor,
                      note: `Average ${formatMoney(data.distribution.averageMinor, data.currency)}`,
                    },
                    {
                      label: 'Largest expense',
                      amount: data.distribution.largest.amountMinor,
                      note:
                        data.distribution.largest.merchant ?? data.distribution.largest.description,
                    },
                  ]),
            ].map((figure) => (
              <div
                key={figure.label}
                className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5"
              >
                <dt className="text-xs text-muted-foreground">{figure.label}</dt>
                <dd className="flex flex-col">
                  <FinancialAmount amountMinor={figure.amount} currency={data.currency} size="sm" />
                  <span className="truncate text-xs text-muted-foreground">{figure.note}</span>
                </dd>
              </div>
            ))}
          </dl>
          {data.distribution !== undefined && (
            <p className="text-sm text-muted-foreground">
              {data.distribution.smallPayments.count.toString()} small payments (up to{' '}
              {formatMoney(data.distribution.smallPayments.thresholdMinor, data.currency)} each)
              added up to {formatMoney(data.distribution.smallPayments.totalMinor, data.currency)} —{' '}
              {formatBasisPoints(data.distribution.smallPayments.shareBasisPoints)} of spending.
              Half of your expenses were between{' '}
              {formatMoney(data.distribution.lowerQuartileMinor, data.currency)} and{' '}
              {formatMoney(data.distribution.upperQuartileMinor, data.currency)}.
            </p>
          )}
          {data.monthly.length > 1 && <MonthlyChart data={data} />}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Categories</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Spending per category</caption>
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
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                      Change
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Typical month
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {data.categories.slice(0, 10).map((item) => (
                    <tr key={item.categoryId ?? item.name}>
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {item.name}
                        {item.largest !== undefined && (
                          <span className="block text-xs text-muted-foreground">
                            Largest {formatMoney(item.largest.amountMinor, data.currency)} on{' '}
                            {formatDate(item.largest.date, 'dayMonth')}
                          </span>
                        )}
                      </th>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {formatMoney(item.totalMinor, data.currency)}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {formatBasisPoints(item.shareBasisPoints)}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {item.change.status === 'available'
                          ? formatBasisPoints(item.change.basisPoints, { signed: true })
                          : 'New'}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {formatMoney(item.medianMonthlyMinor, data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: 'Most spent with', items: data.topMerchantsBySpend },
              { title: 'Paid most often', items: data.topMerchantsByCount },
            ].map((list) => (
              <div key={list.title} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{list.title}</h3>
                {list.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No merchants or descriptions recorded.
                  </p>
                ) : (
                  <ol className="divide-y rounded-lg border">
                    {list.items.slice(0, 6).map((merchant) => (
                      <li
                        key={merchant.key}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{merchant.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {merchant.count.toString()} payments (before:{' '}
                            {merchant.previousCount.toString()}) · average{' '}
                            {formatMoney(merchant.averageMinor, data.currency)}
                            {merchant.mainCategory !== undefined &&
                            merchant.shareOfCategoryBasisPoints !== undefined
                              ? ` · ${formatBasisPoints(merchant.shareOfCategoryBasisPoints)} of ${merchant.mainCategory}`
                              : ''}
                          </span>
                        </span>
                        <FinancialAmount
                          amountMinor={merchant.totalMinor}
                          currency={data.currency}
                          size="sm"
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Merchants are grouped by the names and descriptions you recorded; they are not verified
            identities.
          </p>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">By day of the week</h3>
            <ul className="grid grid-cols-7 gap-1 text-center text-xs">
              {data.weekdays.map((day) => (
                <li
                  key={day.weekday}
                  className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-1 py-2"
                >
                  <span className="text-muted-foreground">{WEEKDAYS[day.weekday - 1]}</span>
                  <span className="tabular-nums">
                    {formatCompactMoney(day.expenseMinor, data.currency)}
                  </span>
                  <span className="text-muted-foreground">{day.count.toString()}</span>
                </li>
              ))}
            </ul>
          </div>
          <SufficiencyNote sufficiency={data.sufficiency} />
          <MethodologyDisclosure methodology={data.methodology} />
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </Card>
      )}
    </section>
  );
}
