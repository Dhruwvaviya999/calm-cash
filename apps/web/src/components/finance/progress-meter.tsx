import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ProgressTone = 'positive' | 'warning' | 'negative' | 'neutral';

const BAR_CLASSES: Readonly<Record<ProgressTone, string>> = {
  positive: 'bg-primary',
  warning: 'bg-warning',
  negative: 'bg-expense',
  neutral: 'bg-muted-foreground/60',
};

export interface ProgressMeterProps {
  /** Percentage used. Values above 100 are allowed (e.g. an overspent budget) and shown as full. */
  percent: number;
  /** Accessible name, e.g. "Groceries budget used". */
  label: string;
  tone: ProgressTone;
  /** Spoken value; defaults to "{percent}% used". Pass the exact figure when it exceeds 100 %. */
  valueText?: string;
  /** Marks on the track (percent of the full bar), e.g. alert thresholds. Decorative. */
  marks?: readonly number[];
  className?: string;
}

/** A thin, accessible progress bar for budgets and goals. */
export function ProgressMeter({
  percent,
  label,
  tone,
  valueText,
  marks = [],
  className,
}: ProgressMeterProps): ReactNode {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={valueText ?? `${percent}% used`}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500',
          BAR_CLASSES[tone],
        )}
        style={{ width: `${clamped}%` }}
      />
      {marks.map((mark) => (
        <span
          key={mark}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-background/80"
          style={{ left: `${Math.min(Math.max(mark, 0), 100)}%` }}
        />
      ))}
    </div>
  );
}
