'use client';

import type {
  CashFlowForecastDto,
  CurrencyCashFlowForecastDto,
  CurrencyCode,
  ForecastHorizon,
  ForecastIncomeBasis,
  SpendingForecastDto,
  SpendingForecastPeriod,
} from '@calmcash/shared';
import { CalendarClock, TrendingUp } from 'lucide-react';
import { useCallback, useId, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
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
  ChartSkeleton,
  ChartTableDisclosure,
  ChartTooltipCard,
  ChartTooltipRow,
} from '@/components/charts/chart-parts';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { SectionHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { formatCompactMoney, formatDate, formatMoney } from '@/lib/format';
import { describeRequestError } from '@/lib/form-errors';
import { getCashFlowForecast, getSpendingForecast } from '@/services/intelligence.service';

import {
  chartNumber,
  FORECAST_HORIZON_OPTIONS,
  forecastPoints,
} from '../intelligence-presentation';
import {
  CalculatedAt,
  ExplainButton,
  FigureKindLabel,
  MethodologyDisclosure,
  SufficiencyNote,
  WarningList,
  type FigureKind,
} from './intelligence-parts';

const FORECAST_HEIGHT = 260;
const POSITION_COLOR = 'var(--color-chart-2)';

function Figure({
  label,
  kind,
  amountMinor,
  currency,
  note,
}: {
  label: string;
  kind: FigureKind;
  amountMinor?: string | undefined;
  currency: CurrencyCode;
  note?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
      <dt className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {label} <FigureKindLabel kind={kind} />
      </dt>
      <dd className="flex flex-col gap-0.5">
        {amountMinor !== undefined && (
          <FinancialAmount amountMinor={amountMinor} currency={currency} size="sm" />
        )}
        {note !== undefined && <span className="text-xs text-muted-foreground">{note}</span>}
      </dd>
    </div>
  );
}

function ForecastChart({ forecast }: { forecast: CurrencyCashFlowForecastDto }): ReactNode {
  const { currency } = forecast;
  const points = forecastPoints(forecast.buckets);
  const renderTooltip = ({ active, activeIndex }: TooltipContentProps): ReactNode => {
    const bucket = active ? forecast.buckets[Number(activeIndex)] : undefined;
    if (bucket === undefined) return null;
    const first = bucket === forecast.buckets[0];
    return (
      <ChartTooltipCard
        title={
          bucket.start === bucket.end
            ? formatDate(bucket.start, 'fullDate')
            : `${formatDate(bucket.start, 'dayMonth')} – ${formatDate(bucket.end, 'dayMonthYear')}`
        }
        note={first ? 'Starts from your actual position now' : 'Projected — an estimate'}
      >
        <ChartTooltipRow
          label="Projected net position"
          value={formatMoney(bucket.projectedPositionMinor, currency)}
          color={POSITION_COLOR}
        />
        <ChartTooltipRow
          label="Scheduled income"
          value={formatMoney(bucket.scheduledIncomeMinor, currency)}
          color={CHART_COLORS.income}
        />
        <ChartTooltipRow
          label="Scheduled bills"
          value={formatMoney(bucket.scheduledExpenseMinor, currency)}
          color={CHART_COLORS.expense}
        />
        <ChartTooltipRow
          label="Estimated everyday spending"
          value={formatMoney(bucket.estimatedVariableMinor, currency)}
        />
      </ChartTooltipCard>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Chart legend" className="flex flex-wrap gap-x-4 gap-y-1">
        <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg aria-hidden="true" width="18" height="6">
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke={POSITION_COLOR}
              strokeWidth="2"
              strokeDasharray="5 3"
            />
          </svg>
          Projected net position (estimate)
        </li>
        <ChartLegendItem label="Scheduled income" color={CHART_COLORS.income} />
        <ChartLegendItem label="Scheduled bills" color={CHART_COLORS.expense} />
      </ul>
      <div
        role="img"
        aria-label={`Projected net position and scheduled payments in ${currency}. Use “Show as table” for every value.`}
        className="-ml-2"
      >
        <ResponsiveContainer width="100%" height={FORECAST_HEIGHT}>
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
              tick={AXIS_TICK}
              interval="preserveStartEnd"
              minTickGap={24}
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
            <ReferenceLine y={0} stroke={CHART_COLORS.axis} strokeOpacity={0.5} />
            <Tooltip content={renderTooltip} cursor={{ fill: CHART_COLORS.cursor, opacity: 0.6 }} />
            <Bar
              dataKey="scheduledIncome"
              fill={CHART_COLORS.income}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            <Bar
              dataKey="scheduledExpense"
              fill={CHART_COLORS.expense}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="position"
              stroke={POSITION_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartTableDisclosure caption={`Projected net position per period, ${currency}`}>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Period
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Scheduled in
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Scheduled out
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Everyday (estimate)
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Projected position
            </th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {forecast.buckets.map((bucket) => (
            <tr key={bucket.start}>
              <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap">
                {bucket.start === bucket.end
                  ? formatDate(bucket.start, 'dayMonth')
                  : `${formatDate(bucket.start, 'dayMonth')} – ${formatDate(bucket.end, 'dayMonth')}`}
              </th>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatMoney(bucket.scheduledIncomeMinor, currency)}
              </td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatMoney(bucket.scheduledExpenseMinor, currency)}
              </td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatMoney(bucket.estimatedVariableMinor, currency)}
              </td>
              <td className="py-1.5 text-right whitespace-nowrap">
                {formatMoney(bucket.projectedPositionMinor, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </ChartTableDisclosure>
    </div>
  );
}

function CurrencyForecast({
  forecast,
  to,
}: {
  forecast: CurrencyCashFlowForecastDto;
  to: string;
}): ReactNode {
  const { currency } = forecast;
  const variable = forecast.variableSpending;
  const income = forecast.estimatedIncome;
  const scheduled = forecast.items;
  return (
    <Card className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            Projected net position on {formatDate(to, 'dayMonthYear')}{' '}
            <FigureKindLabel kind="estimated" />
          </p>
          <FinancialAmount
            amountMinor={forecast.projected.endingPositionMinor}
            currency={currency}
            size="lg"
          />
          {forecast.projected.lowMinor !== undefined &&
            forecast.projected.highMinor !== undefined && (
              <p className="text-xs text-muted-foreground">
                Between {formatMoney(forecast.projected.lowMinor, currency)} and{' '}
                {formatMoney(forecast.projected.highMinor, currency)} if everyday spending matched
                your highest or lowest recent month. Not a guaranteed balance.
              </p>
            )}
        </div>
        <StatusBadge tone="neutral" showIcon={false}>
          {currency}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Figure
          label="Net position now"
          kind="actual"
          amountMinor={forecast.starting.netPositionMinor}
          currency={currency}
          note={`Held ${formatMoney(forecast.starting.heldMinor, currency)} − owed ${formatMoney(forecast.starting.owedMinor, currency)}`}
        />
        <Figure
          label="Scheduled income"
          kind="scheduled"
          amountMinor={forecast.scheduledIncome.amountMinor}
          currency={currency}
          note={`${forecast.scheduledIncome.count.toString()} expected${forecast.overdueIncomeNotCounted.count > 0 ? `; ${forecast.overdueIncomeNotCounted.count.toString()} overdue not counted` : ''}`}
        />
        <Figure
          label="Scheduled bills and subscriptions"
          kind="scheduled"
          amountMinor={forecast.scheduledExpenses.amountMinor}
          currency={currency}
          note={`${forecast.scheduledExpenses.count.toString()} expected${forecast.scheduledExpenses.overdueCount > 0 ? `, ${forecast.scheduledExpenses.overdueCount.toString()} overdue` : ''}`}
        />
        <Figure
          label="Everyday spending"
          kind="estimated"
          amountMinor={variable.status === 'available' ? variable.amountMinor : undefined}
          currency={currency}
          note={
            variable.status === 'available'
              ? `Typical month ${formatMoney(variable.monthlyBaselineMinor, currency)} (median of ${variable.monthsUsed.toString()} months)`
              : 'Not estimated: not enough history yet'
          }
        />
        <Figure
          label="Income without a schedule"
          kind="estimated"
          amountMinor={income.status === 'included' ? income.amountMinor : undefined}
          currency={currency}
          note={
            income.status === 'unavailable'
              ? 'Not enough history'
              : income.status === 'included'
                ? 'Included at your typical month'
                : `Not assumed (typical month ${formatMoney(income.monthlyBaselineMinor, currency)})`
          }
        />
        <Figure
          label="This month so far"
          kind="actual"
          currency={currency}
          note={`In ${formatMoney(forecast.monthToDate.incomeMinor, currency)} · out ${formatMoney(forecast.monthToDate.expenseMinor, currency)}`}
        />
      </dl>
      <ForecastChart forecast={forecast} />
      {scheduled.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock aria-hidden="true" className="size-4" /> Scheduled in this period
          </h3>
          <ul className="divide-y rounded-lg border">
            {scheduled.map((item) => (
              <li
                key={`${item.scheduleId}:${item.scheduledDate}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.status === 'overdue' ? 'Overdue since ' : 'Due '}
                    {formatDate(item.dueDate, 'dayMonthYear')}
                    {item.postponed ? ' (postponed)' : ''}
                    {item.counted ? '' : ' · not counted'}
                  </span>
                </span>
                <FinancialAmount
                  amountMinor={item.amountMinor}
                  currency={currency}
                  direction={item.type === 'income' ? 'credit' : 'debit'}
                  size="sm"
                />
              </li>
            ))}
          </ul>
          {forecast.itemsTruncated && (
            <p className="text-xs text-muted-foreground">Only the first payments are listed.</p>
          )}
        </div>
      )}
      <SufficiencyNote sufficiency={forecast.sufficiency} />
      <WarningList warnings={forecast.warnings} />
    </Card>
  );
}

export function CashFlowForecastSection({
  currency,
  timeZone,
  aiAvailable,
}: {
  currency: CurrencyCode | undefined;
  timeZone: string;
  aiAvailable: boolean;
}): ReactNode {
  const periodId = useId();
  const [horizon, setHorizon] = useState<ForecastHorizon>(30);
  const [income, setIncome] = useState<ForecastIncomeBasis>('scheduled');
  const forecast = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<CashFlowForecastDto> =>
        getCashFlowForecast({ horizon, income, currency }, signal),
      [horizon, income, currency],
    ),
  );
  const data = forecast.state.status === 'success' ? forecast.state.data : undefined;
  const shown =
    data?.forecasts.filter((entry) => currency === undefined || entry.currency === currency) ?? [];

  return (
    <section aria-labelledby="forecast-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="forecast-heading"
        title="Cash-flow forecast"
        description="Where your money could stand, from your balances now, your scheduled bills and income, and your typical everyday spending. An estimate, not a promise."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1 text-sm sm:w-48">
          <label htmlFor={periodId} className="text-muted-foreground">
            Period
          </label>
          <NativeSelect
            id={periodId}
            value={String(horizon)}
            onChange={(event) => {
              const next = FORECAST_HORIZON_OPTIONS.find(
                (option) => String(option.value) === event.target.value,
              );
              if (next !== undefined) setHorizon(next.value);
            }}
          >
            {FORECAST_HORIZON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={income === 'scheduled_and_estimated'}
            onChange={(event) => {
              setIncome(event.target.checked ? 'scheduled_and_estimated' : 'scheduled');
            }}
          />
          Include typical income that has no schedule (an estimate)
        </label>
      </div>
      {forecast.state.status === 'loading' && (
        <ChartSkeleton height={FORECAST_HEIGHT} label="Loading the forecast" />
      )}
      {forecast.state.status === 'error' && (
        <ErrorState
          title="The forecast could not be loaded"
          description={describeRequestError(forecast.state.error)}
          onRetry={forecast.reload}
        />
      )}
      {data !== undefined && (
        <>
          {shown.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              headingLevel="h3"
              title="Nothing to forecast yet"
              description="Add an account and record a few weeks of income and spending, or schedule your regular bills, to see a forecast."
            />
          ) : (
            shown.map((entry) => (
              <CurrencyForecast key={entry.currency} forecast={entry} to={data.to} />
            ))
          )}
          <WarningList warnings={data.warnings} />
          <ExplainButton
            input={{
              subject: 'cashflow_forecast',
              horizon,
              ...(currency === undefined ? {} : { currency }),
            }}
            aiAvailable={aiAvailable}
          />
          <MethodologyDisclosure methodology={data.methodology} />
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </>
      )}
    </section>
  );
}

// --- Category predictions ------------------------------------------------------------------------

interface CategoryPoint {
  name: string;
  actual: number;
  remaining: number;
}

const CATEGORY_LIMIT = 8;

export function CategoryPredictionsSection({
  currency,
  timeZone,
  aiAvailable,
}: {
  currency: CurrencyCode | undefined;
  timeZone: string;
  aiAvailable: boolean;
}): ReactNode {
  const monthId = useId();
  const [period, setPeriod] = useState<SpendingForecastPeriod>('this-month');
  const forecast = useAsyncResource(
    useCallback(
      (signal: AbortSignal): Promise<SpendingForecastDto> =>
        getSpendingForecast({ period, currency }, signal),
      [period, currency],
    ),
  );
  const data = forecast.state.status === 'success' ? forecast.state.data : undefined;
  const items = data?.categories.slice(0, CATEGORY_LIMIT) ?? [];
  const points: CategoryPoint[] = items.map((item) => ({
    name: item.name,
    actual: chartNumber(item.actualToDateMinor),
    remaining:
      item.estimate.status === 'available' ? chartNumber(item.estimate.expectedRemainingMinor) : 0,
  }));

  const renderTooltip = ({ active, activeIndex }: TooltipContentProps): ReactNode => {
    const item = active ? items[Number(activeIndex)] : undefined;
    if (item === undefined || data === undefined) return null;
    return (
      <ChartTooltipCard
        title={item.name}
        note={
          item.estimate.status === 'available'
            ? 'Actual so far plus an estimate'
            : 'Actual only — not enough history to estimate'
        }
      >
        <ChartTooltipRow
          label="Actual so far"
          value={formatMoney(item.actualToDateMinor, data.currency)}
          color={CHART_COLORS.expense}
        />
        {item.estimate.status === 'available' && (
          <>
            <ChartTooltipRow
              label="Still expected (estimate)"
              value={formatMoney(item.estimate.expectedRemainingMinor, data.currency)}
            />
            <ChartTooltipRow
              label="Estimated month end"
              value={formatMoney(item.estimate.estimatedPeriodEndMinor, data.currency)}
            />
          </>
        )}
        {item.budget !== undefined && (
          <ChartTooltipRow
            label="Budget limit"
            value={formatMoney(item.budget.limitMinor, data.currency)}
          />
        )}
      </ChartTooltipCard>
    );
  };

  return (
    <section aria-labelledby="category-predictions-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="category-predictions-heading"
        title="Category predictions"
        description="What each category could reach by the end of the month: what you have spent so far, plus your typical month for the days still to come."
      />
      <div className="flex flex-col gap-1 text-sm sm:w-48">
        <label htmlFor={monthId} className="text-muted-foreground">
          Month
        </label>
        <NativeSelect
          id={monthId}
          value={period}
          onChange={(event) => {
            setPeriod(event.target.value === 'next-month' ? 'next-month' : 'this-month');
          }}
        >
          <option value="this-month">This month</option>
          <option value="next-month">Next month</option>
        </NativeSelect>
      </div>
      {forecast.state.status === 'loading' && (
        <ChartSkeleton height={280} label="Loading category predictions" />
      )}
      {forecast.state.status === 'error' && (
        <ErrorState
          title="Category predictions could not be loaded"
          description={describeRequestError(forecast.state.error)}
          onRetry={forecast.reload}
        />
      )}
      {data !== undefined && (
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Figure
              label="Spent so far"
              kind="actual"
              amountMinor={data.totals.actualToDateMinor}
              currency={data.currency}
            />
            <Figure
              label="Still expected"
              kind="estimated"
              amountMinor={data.totals.expectedRemainingMinor}
              currency={data.currency}
            />
            <Figure
              label="Estimated month end"
              kind="estimated"
              amountMinor={data.totals.estimatedPeriodEndMinor}
              currency={data.currency}
              note={`${formatDate(data.from, 'dayMonth')} – ${formatDate(data.to, 'dayMonthYear')} · ${data.currency}`}
            />
          </dl>
          {data.scheduledRemaining.count > 0 && (
            <p className="text-sm text-muted-foreground">
              {data.scheduledRemaining.count.toString()} scheduled bills and subscriptions (
              {formatMoney(data.scheduledRemaining.amountMinor, data.currency)}) are still due in
              this month; they are part of the categories they belong to.
            </p>
          )}
          {items.length === 0 ? (
            <ChartEmptyState
              title="No spending to predict yet"
              description="Category predictions need a few completed months of recorded expenses."
            />
          ) : (
            <>
              <ul aria-label="Chart legend" className="flex flex-wrap gap-x-4 gap-y-1">
                <ChartLegendItem label="Actual so far" color={CHART_COLORS.expense} />
                <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-[3px] border border-dashed border-muted-foreground"
                  />
                  Still expected (estimate)
                </li>
              </ul>
              <div
                role="img"
                aria-label={`Actual and estimated spending per category in ${data.currency}. Use “Show as table” for every value.`}
              >
                <ResponsiveContainer width="100%" height={Math.max(160, points.length * 40)}>
                  <BarChart
                    data={points}
                    layout="vertical"
                    barCategoryGap="30%"
                    margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
                    <XAxis
                      type="number"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) =>
                        formatCompactMoney(BigInt(Math.round(value)), data.currency)
                      }
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      content={renderTooltip}
                      cursor={{ fill: CHART_COLORS.cursor, opacity: 0.6 }}
                    />
                    <Bar
                      dataKey="actual"
                      stackId="spend"
                      fill={CHART_COLORS.expense}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="remaining"
                      stackId="spend"
                      fill={CHART_COLORS.expense}
                      fillOpacity={0.18}
                      stroke={CHART_COLORS.expense}
                      strokeDasharray="4 3"
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartTableDisclosure caption={`Category predictions, ${data.currency}`}>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Category
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                      Actual
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                      Typical month
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                      Estimated end
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Trend
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {data.categories.map((item) => (
                    <tr key={item.categoryId ?? item.name}>
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {item.name}
                      </th>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {formatMoney(item.actualToDateMinor, data.currency)}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {formatMoney(item.history.medianMinor, data.currency)}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {item.estimate.status === 'available'
                          ? formatMoney(item.estimate.estimatedPeriodEndMinor, data.currency)
                          : 'Not enough history'}
                      </td>
                      <td className="py-1.5 text-right">
                        {item.trend === 'unknown' ? '—' : item.trend}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ChartTableDisclosure>
            </>
          )}
          <SufficiencyNote sufficiency={data.sufficiency} />
          <ExplainButton
            input={{ subject: 'spending_forecast', currency: data.currency }}
            aiAvailable={aiAvailable && data.period === 'this-month'}
          />
          <MethodologyDisclosure methodology={data.methodology} />
          <CalculatedAt at={data.calculatedAt} timeZone={timeZone} />
        </Card>
      )}
    </section>
  );
}
