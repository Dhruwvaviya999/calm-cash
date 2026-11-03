'use client';

import type { ScenarioGoalOutcomeDto, ScenarioResultDto } from '@calmcash/shared';
import type { ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import {
  AXIS_TICK,
  CHART_COLORS,
  ChartTableDisclosure,
  ChartTooltipCard,
  ChartTooltipRow,
} from '@/components/charts/chart-parts';
import { StatusBadge } from '@/components/feedback/status-badge';
import { FinancialAmount } from '@/components/finance/financial-amount';
import { Card } from '@/components/ui/card';
import {
  CalculatedAt,
  ExplainButton,
  FigureKindLabel,
  GOAL_STATE_PRESENTATION,
  SufficiencyNote,
  chartNumber,
} from '@/features/intelligence';
import { formatCompactMoney, formatDate, formatMoney } from '@/lib/format';

// A simulation result: baseline and simulated projections side by side. Both are estimates; the
// difference is shown in neutral ink (a hypothetical improvement is not a success), and every
// value carries a "Simulation" or "Estimate" label.

const BASELINE_COLOR = 'var(--color-muted-foreground)';
const SIMULATED_COLOR = 'var(--color-chart-2)';

function Line2({ color, dashed }: { color: string; dashed: boolean }): ReactNode {
  return (
    <svg aria-hidden="true" width="18" height="6">
      <line
        x1="0"
        y1="3"
        x2="18"
        y2="3"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashed ? '5 3' : undefined}
      />
    </svg>
  );
}

function outcomeText(
  outcome: ScenarioGoalOutcomeDto,
  currency: ScenarioResultDto['currency'],
): string {
  const parts = [GOAL_STATE_PRESENTATION[outcome.state].label];
  if (outcome.projectedCompletionDate !== undefined) {
    parts.push(`around ${formatDate(outcome.projectedCompletionDate, 'monthYear')}`);
  }
  if (outcome.requiredMonthlyMinor !== undefined) {
    parts.push(`${formatMoney(outcome.requiredMonthlyMinor, currency)} a month needed`);
  }
  return parts.join(' · ');
}

export function ScenarioResult({
  result,
  timeZone,
  aiAvailable,
}: {
  result: ScenarioResultDto;
  timeZone: string;
  aiAvailable: boolean;
}): ReactNode {
  const { currency } = result;
  const points = result.timeline.map((point) => ({
    label: formatDate(point.date, 'dayMonth'),
    baseline: chartNumber(point.baselineMinor),
    simulated: chartNumber(point.simulatedMinor),
  }));
  const renderTooltip = ({ active, activeIndex }: TooltipContentProps): ReactNode => {
    const point = active ? result.timeline[Number(activeIndex)] : undefined;
    if (point === undefined) return null;
    return (
      <ChartTooltipCard title={formatDate(point.date, 'fullDate')} note="Both lines are estimates">
        <ChartTooltipRow
          label="Without changes"
          value={formatMoney(point.baselineMinor, currency)}
          color={BASELINE_COLOR}
        />
        <ChartTooltipRow
          label="With the changes (simulation)"
          value={formatMoney(point.simulatedMinor, currency)}
          color={SIMULATED_COLOR}
        />
      </ChartTooltipCard>
    );
  };

  return (
    <Card className="flex flex-col gap-5 p-4 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="font-medium">{result.name}</h3>
          <p className="text-xs text-muted-foreground">
            {formatDate(result.from, 'dayMonth')} – {formatDate(result.to, 'dayMonthYear')} ·{' '}
            {currency}
          </p>
        </div>
        <StatusBadge tone="neutral">Simulation — nothing was changed</StatusBadge>
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Without changes <FigureKindLabel kind="estimated" />
          </dt>
          <dd>
            <FinancialAmount
              amountMinor={result.baseline.endingPositionMinor}
              currency={currency}
              size="lg"
            />
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            With the changes <FigureKindLabel kind="simulated" />
          </dt>
          <dd>
            <FinancialAmount
              amountMinor={result.simulated.endingPositionMinor}
              currency={currency}
              size="lg"
            />
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">
            Difference by {formatDate(result.to, 'dayMonth')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {result.differenceMinor.startsWith('-') ? '' : '+'}
            {formatMoney(result.differenceMinor, currency)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Projected net position (money held minus money owed). Spending:{' '}
        {formatMoney(result.baseline.expensesMinor, currency)} →{' '}
        {formatMoney(result.simulated.expensesMinor, currency)}; income:{' '}
        {formatMoney(result.baseline.incomeMinor, currency)} →{' '}
        {formatMoney(result.simulated.incomeMinor, currency)}.
      </p>
      {result.heldAndOwed !== undefined && (
        <p className="text-sm text-muted-foreground">
          Money held {formatMoney(result.heldAndOwed.baselineHeldMinor, currency)} →{' '}
          {formatMoney(result.heldAndOwed.simulatedHeldMinor, currency)}; owed{' '}
          {formatMoney(result.heldAndOwed.baselineOwedMinor, currency)} →{' '}
          {formatMoney(result.heldAndOwed.simulatedOwedMinor, currency)}. Paying debt from money
          held leaves the net position unchanged.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <ul
          aria-label="Chart legend"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <li className="flex items-center gap-1.5">
            <Line2 color={BASELINE_COLOR} dashed={false} /> Without changes (estimate)
          </li>
          <li className="flex items-center gap-1.5">
            <Line2 color={SIMULATED_COLOR} dashed /> With the changes (simulation)
          </li>
        </ul>
        <div
          role="img"
          aria-label={`Projected net position with and without the changes, ${currency}. Use “Show as table” for every value.`}
          className="-ml-2"
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              <Tooltip
                content={renderTooltip}
                cursor={{ stroke: CHART_COLORS.axis, strokeOpacity: 0.4 }}
              />
              <Line
                type="monotone"
                dataKey="baseline"
                stroke={BASELINE_COLOR}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="simulated"
                stroke={SIMULATED_COLOR}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ChartTableDisclosure
          caption={`Projected net position with and without the changes, ${currency}`}
        >
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                Without changes
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                With the changes
              </th>
            </tr>
          </thead>
          <tbody className="divide-y tabular-nums">
            {result.timeline.map((point) => (
              <tr key={point.date}>
                <th scope="row" className="py-1.5 pr-3 font-normal">
                  {formatDate(point.date, 'dayMonthYear')}
                </th>
                <td className="py-1.5 pr-3 text-right">
                  {formatMoney(point.baselineMinor, currency)}
                </td>
                <td className="py-1.5 text-right">{formatMoney(point.simulatedMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </ChartTableDisclosure>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Each change</h4>
        <ul className="divide-y rounded-lg border">
          {result.effects.map((effect) => (
            <li
              key={effect.index}
              className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span>{effect.description}</span>
                {effect.reason !== undefined && (
                  <span className="text-xs text-muted-foreground">{effect.reason}</span>
                )}
              </span>
              {effect.status === 'applied' ? (
                <span className="tabular-nums">
                  {effect.positionChangeMinor.startsWith('-') ? '' : '+'}
                  {formatMoney(effect.positionChangeMinor, currency)}
                </span>
              ) : (
                <StatusBadge tone="warning">Not applied</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </div>

      {result.goalImpacts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">Savings goals</h4>
          <ul className="flex flex-col gap-2">
            {result.goalImpacts.map((impact) => (
              <li key={impact.goalId} className="rounded-lg border px-3 py-2 text-sm">
                <p className="font-medium">{impact.name}</p>
                <p className="text-muted-foreground">
                  Now: {outcomeText(impact.baseline, currency)}
                </p>
                <p className="text-muted-foreground">
                  In this simulation: {outcomeText(impact.simulated, currency)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.budgetImpacts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">Budgets</h4>
          <ul className="flex flex-col gap-2">
            {result.budgetImpacts.map((impact) => (
              <li key={impact.budgetId} className="rounded-lg border px-3 py-2 text-sm">
                <p className="font-medium">
                  {impact.name} (limit {formatMoney(impact.limitMinor, currency)} a month)
                </p>
                <p className="text-muted-foreground">
                  Typical month {formatMoney(impact.baselineMonthlyMinor, currency)} →{' '}
                  {formatMoney(impact.simulatedMonthlyMinor, currency)} in this simulation
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="rounded-lg border bg-card px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
          Assumptions and limitations
        </summary>
        <ul className="mt-2 list-disc pl-5 text-muted-foreground">
          {[...result.assumptions, ...result.limitations].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <SufficiencyNote sufficiency={result.sufficiency} />
      {result.scenarioId !== undefined && (
        <ExplainButton
          input={{ subject: 'scenario', scenarioId: result.scenarioId }}
          aiAvailable={aiAvailable}
        />
      )}
      <p className="text-xs text-muted-foreground">{result.recalculationPolicy}</p>
      <CalculatedAt at={result.calculatedAt} timeZone={timeZone} />
    </Card>
  );
}
