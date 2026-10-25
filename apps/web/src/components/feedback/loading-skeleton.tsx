import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const BLOCK = 'bg-muted';

/** Placeholder rows shaped like transaction or settings lists. */
export function ListSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}): ReactNode {
  return (
    <ul aria-hidden="true" className={cn('flex flex-col divide-y', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-3 py-3">
          <Skeleton className={cn('size-10 shrink-0 rounded-xl', BLOCK)} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={cn('h-4 w-2/5', BLOCK)} />
            <Skeleton className={cn('h-3 w-3/5', BLOCK)} />
          </div>
          <Skeleton className={cn('h-4 w-16', BLOCK)} />
        </li>
      ))}
    </ul>
  );
}

/** Generic page placeholder used while a route segment streams in. */
export function PageSkeleton(): ReactNode {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6 md:gap-8">
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className={cn('h-8 w-48', BLOCK)} />
        <Skeleton className={cn('h-4 w-full max-w-md', BLOCK)} />
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className={cn('h-28 rounded-2xl', BLOCK)} />
        ))}
      </div>
      <div aria-hidden="true" className="rounded-2xl border bg-card px-5 py-2">
        <ListSkeleton rows={5} />
      </div>
    </div>
  );
}
