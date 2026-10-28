import type { ChangeEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Lays out search and filter controls: stacked on mobile, in one row on wider screens. */
export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface FilterOption<TValue extends string> {
  value: TValue;
  label: string;
}

export interface FilterOptionsProps<TValue extends string> {
  /** Accessible name of the group, e.g. "Transaction type". */
  legend: string;
  /** Unique form name for the radio group. */
  name: string;
  options: readonly FilterOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  className?: string;
}

/**
 * A segmented single-choice filter built on native radio inputs, so arrow-key navigation and
 * screen-reader semantics come from the browser. Scrolls horizontally on very narrow screens.
 */
export function FilterOptions<TValue extends string>({
  legend,
  name,
  options,
  value,
  onValueChange,
  className,
}: FilterOptionsProps<TValue>): ReactNode {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-1 py-0.5">
        {options.map((option) => (
          // `relative` keeps the visually hidden radio inside the scrolling row; otherwise it is
          // positioned against the page and widens it when the options overflow.
          <label key={option.value} className="relative shrink-0">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (event.target.checked) {
                  onValueChange(option.value);
                }
              }}
              className="peer sr-only"
            />
            <span className="inline-flex h-10 cursor-pointer items-center rounded-full border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors select-none peer-checked:border-primary/40 peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:text-foreground sm:h-9">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
