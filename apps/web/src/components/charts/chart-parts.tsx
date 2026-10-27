import { ChartNoAxesColumn, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Pieces every CalmCash chart is built from. Charts draw marks in the validated chart tokens and
// keep all text in text tokens; values shown here always come from exact, formatted strings.

/** Chart colours as CSS variables, so both themes apply without re-rendering. */
export const CHART_COLORS = {
  income: 'var(--color-chart-income)',
  expense: 'var(--color-chart-expense)',
  grid: 'var(--color-border)',
  axis: 'var(--color-muted-foreground)',
  cursor: 'var(--color-muted)',
} as const;

/** Axis tick text: small, muted, tabular figures. */
export const AXIS_TICK = { fill: CHART_COLORS.axis, fontSize: 12 } as const;

/** The floating card of a chart tooltip. */
export function ChartTooltipCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | undefined;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="min-w-44 rounded-xl border bg-popover px-3 py-2.5 text-popover-foreground shadow-md">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {note !== undefined && <p className="text-2xs text-muted-foreground">{note}</p>}
      <dl className="mt-1.5 flex flex-col gap-1">{children}</dl>
    </div>
  );
}

/**
 * One tooltip row: the value leads, the series name follows, and a short line in the series
 * colour carries identity (text never wears the data colour).
 */
export function ChartTooltipRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string | undefined;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 text-sm">
      {color === undefined ? (
        <span aria-hidden="true" className="w-3" />
      ) : (
        <span
          aria-hidden="true"
          className="h-0.5 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {/* Name first in the markup (as a description list requires), value first on screen. */}
      <dt className="order-last text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Legend entry: a swatch shaped like the mark (a bar) beside the series name. */
export function ChartLegendItem({ label, color }: { label: string; color: string }): ReactNode {
  return (
    <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-2.5 rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      {label}
    </li>
  );
}

/** Why there is nothing to draw: never a flat line or invented points. */
export function ChartEmptyState({
  title,
  description,
  icon: Icon = ChartNoAxesColumn,
  className,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-6 py-10 text-center',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
    </div>
  );
}

/** Placeholder with the chart's final height, so loading never shifts the layout. */
export function ChartSkeleton({ height, label }: { height: number; label: string }): ReactNode {
  return (
    <div role="status" aria-live="polite" style={{ height }} className="flex items-end gap-2">
      <span className="sr-only">{label}</span>
      {[40, 65, 30, 80, 55, 70, 45, 60].map((percent, index) => (
        <Skeleton
          key={index}
          aria-hidden="true"
          className="flex-1 rounded-t-md rounded-b-none bg-muted"
          style={{ height: `${String(percent)}%` }}
        />
      ))}
    </div>
  );
}

/** The chart's data as a table, one click away: the accessible and exact view of every value. */
export function ChartTableDisclosure({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}): ReactNode {
  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Show as table
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </details>
  );
}
