import { Sprout } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface WordmarkProps {
  /** `full` shows the mark and the name; `mark` shows only the icon tile (with an accessible name). */
  variant?: 'full' | 'mark';
  className?: string;
}

/** The CalmCash brand: an emerald tile with a sprout (steady growth) beside the name. */
export function Wordmark({ variant = 'full', className }: WordmarkProps): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-[0.625rem] bg-primary text-primary-foreground shadow-sm"
      >
        <Sprout className="size-[1.125rem]" strokeWidth={2.25} />
      </span>
      {variant === 'full' ? (
        <span className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
          Calm<span className="text-primary">Cash</span>
        </span>
      ) : (
        <span className="sr-only">CalmCash</span>
      )}
    </span>
  );
}
