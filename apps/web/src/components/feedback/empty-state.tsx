import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Rendered above the title, e.g. a "Coming soon" badge. */
  badge?: ReactNode;
  /** Extra content below the description: actions or a short list of what is coming. */
  children?: ReactNode;
  /** Heading level that fits the surrounding outline (`h1` when it is the page's main content). */
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}

/** Explains why an area is empty (or not available yet) and what will appear there. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  badge,
  children,
  headingLevel: Heading = 'h2',
  className,
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed bg-card/60 px-6 py-10 text-center sm:py-14',
        className,
      )}
    >
      <div className="relative mb-5 grid size-16 place-items-center rounded-full bg-accent text-accent-foreground ring-8 ring-accent/40">
        <Icon aria-hidden="true" className="size-7" strokeWidth={1.75} />
      </div>
      {badge}
      <Heading
        className={cn(
          'text-lg font-semibold tracking-tight text-balance',
          badge !== undefined && 'mt-3',
        )}
      >
        {title}
      </Heading>
      <p className="mt-2 max-w-md text-pretty text-muted-foreground">{description}</p>
      {children !== undefined && <div className="mt-6 w-full max-w-md">{children}</div>}
    </div>
  );
}
